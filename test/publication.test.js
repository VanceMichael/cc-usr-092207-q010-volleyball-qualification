import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from './util.js';
import { publish, snapshotAt } from '../src/publication.js';
import { diffSnapshots, explainTeam, teamRecordBook } from '../src/explain.js';

const tournament = await readJson('../fixtures/tournament.json');
const { events } = await readJson('../fixtures/events.json');
const saved = await readJson('../fixtures/publications.json');

const name = (id) => tournament.displayNameOf[id] ?? id;

test('fixture 可重算，且与已发布 v1/v2 完全一致（快照可再生）', () => {
  const v1 = publish(
    tournament,
    events,
    {
      version: 1,
      publishedAt: '2025-09-21T12:00:00+08:00',
      cutoffTs: '2025-09-21T00:00:00+08:00',
      note: saved.publications[0].note,
    }
  );
  const v2 = publish(
    tournament,
    events,
    { version: 2, publishedAt: '2025-09-24T21:00:00+08:00', note: saved.publications[1].note },
    [v1]
  );
  assert.deepEqual(v1, saved.publications[0]);
  assert.deepEqual(v2, saved.publications[1]);
});

test('v1：各组前两名与两个成绩最好第三名共八强；固定交叉对阵正确', () => {
  const v1 = saved.publications[0];
  assert.deepEqual(v1.seeds.map((s) => name(s.team)), [
    '蓝湾', '静海', '沙溪', '青川', '松阳', '江洲', '云港', '梅浦',
  ]);
  const qf = Object.fromEntries(v1.quarterfinals.map((q) => [q.matchId, [name(q.home), name(q.away)]]));
  assert.deepEqual(qf.QF1, ['蓝湾', '梅浦']); // 1 vs 8
  assert.deepEqual(qf.QF2, ['青川', '松阳']); // 4 vs 5
  assert.deepEqual(qf.QF3, ['沙溪', '江洲']); // 3 vs 6
  assert.deepEqual(qf.QF4, ['静海', '云港']); // 2 vs 7
  assert.ok(v1.quarterfinals.every((q) => !q.locked));

  // 两个第三名资格
  const third = Object.fromEntries(v1.thirdPlace.map((t) => [name(t.team), t.qualified]));
  assert.equal(third['云港'], true);
  assert.equal(third['梅浦'], true);
  assert.equal(third['鹤城'], false);
});

test('v1：蓝湾/静海全部指标相同，抽签决定 1/2 号签', () => {
  const v1 = saved.publications[0];
  const [lw, jh] = [v1.seeds.find((s) => s.team === 'LW'), v1.seeds.find((s) => s.team === 'JH')];
  assert.equal(lw.seed, 1);
  assert.equal(jh.seed, 2);
  assert.equal(lw.decidedBy, 'draw');
  assert.equal(jh.decidedBy, 'draw');
});

test('v1→v2：改判与撤销扣分改变名次与签位', () => {
  const [v1, v2] = saved.publications;
  const d = diffSnapshots(v1, v2);
  assert.ok(d.hasChanges);
  // 江洲从 6 号升到 4 号；鹤城进入 7 号；梅浦掉出
  const seedMove = (team) => d.seeds.find((x) => x.team === team);
  assert.deepEqual([seedMove('JZ').from, seedMove('JZ').to], [6, 4]);
  assert.deepEqual([seedMove('HC').from, seedMove('HC').to], [null, 7]);
  assert.deepEqual([seedMove('MP').from, seedMove('MP').to], [8, null]);
  // B 组沙溪被追回一局后积分 12→11，但仍居首
  const bg = d.groups.find((g) => g.groupId === 'B');
  assert.ok(bg.changes.some((c) => c.team === 'JZ' && c.from.points === 7 && c.to.points === 9));
});

test('v2：QF4 已开赛锁定为静海-云港，且标记与重算结果的冲突', () => {
  const v2 = saved.publications[1];
  const qf4 = v2.quarterfinals.find((q) => q.matchId === 'QF4');
  assert.equal(qf4.locked, true);
  assert.equal(name(qf4.home), '静海');
  assert.equal(name(qf4.away), '云港');
  assert.equal(qf4.conflict, 'lockedFixtureDiffersFromRecomputed');
  assert.deepEqual([name(qf4.desiredHome), name(qf4.desiredAway)], ['静海', '鹤城']);

  // 未开赛的 QF1-QF3 已重排
  const qf2 = v2.quarterfinals.find((q) => q.matchId === 'QF2');
  assert.equal(qf2.locked, false);
  assert.deepEqual([name(qf2.home), name(qf2.away)], ['江洲', '青川']);

  const types = v2.conflicts.map((c) => c.type);
  assert.ok(types.includes('lockedQuarterfinal'));
  assert.ok(types.includes('teamDoubleBooked'));
  assert.ok(types.includes('qualifierDisplacedByLock'));
  // 被占席的是鹤城
  assert.ok(v2.conflicts.some((c) => c.type === 'qualifierDisplacedByLock' && c.team === 'HC'));
});

test('版本不能覆盖：重复版本号发布被拒；无开赛前快照时开赛锁定报错', () => {
  const [v1] = saved.publications;
  assert.throws(
    () => publish(tournament, events, { version: 1, publishedAt: '2025-09-25T10:00:00+08:00', note: 'x' }, [v1]),
    /不能覆盖/
  );

  // 取一个“只有开赛、没有此前发布”的事件前缀：锁定无从引用
  assert.throws(
    () =>
      publish(
        tournament,
        events,
        { version: 9, publishedAt: '2025-09-24T21:00:00+08:00', note: 'x' },
        []
      ),
    /没有开赛前发布的对阵可供锁定/
  );
});

test('历史版本可独立重放：截止 09-21 时改判与撤罚均未生效', () => {
  const { evaluation } = snapshotAt(tournament, events, { cutoffTs: '2025-09-21T00:00:00+08:00' });
  const sx = evaluation.groups.find((g) => g.group.id === 'B').order.find((r) => r.team === 'SX');
  const jz = evaluation.groups.find((g) => g.group.id === 'B').order.find((r) => r.team === 'JZ');
  assert.equal(sx.points, 12);
  assert.equal(jz.points, 7); // 处罚仍有效
});

test('解释：任意版本都能说明某队为何晋级/落在该签位', () => {
  const [v1, v2] = saved.publications;
  const hc1 = explainTeam(v1, 'HC');
  assert.equal(hc1.eliminated, true);
  assert.match(hc1.qualificationReason, /未晋级/);

  const hc2 = explainTeam(v2, 'HC');
  assert.equal(hc2.seed.seed, 7);
  assert.match(hc2.qualificationReason, /跨组比较第 1 名/);

  const jz2 = explainTeam(v2, 'JZ');
  assert.equal(jz2.seed.seed, 4);
  assert.match(jz2.qualificationReason, /直接晋级/);
  // 江洲 v2 积分已恢复
  assert.equal(jz2.group.stats['积分'], 9);
  assert.equal(jz2.group.stats['处罚扣分'], 0);
});

test('球队原始记录簿：保留误记原貌、改判引用与处罚撤销，并标注当前生效版本', () => {
  const book = teamRecordBook(events, 'HC');
  const gb01 = book.matches.find((m) => m.matchId === 'GB01');
  assert.equal(gb01.versions.length, 2);
  assert.equal(gb01.versions[0].type, 'matchResult');
  assert.equal(gb01.versions[1].type, 'correction');
  assert.equal(gb01.currentRecordId, 'COR-GB01-01');
  // 原始误记仍可核对：3:1
  assert.equal(gb01.versions[0].sets.length, 4);
  assert.equal(gb01.versions[1].sets.length, 5);

  const jzBook = teamRecordBook(events, 'JZ');
  assert.equal(jzBook.penalties.length, 1);
  assert.equal(jzBook.reversals.length, 1);
  assert.equal(jzBook.reversals[0].penaltyId, 'PEN-JZ-01');
});

test('所有发布快照都带版本号与发布时间，且列明所依据的记录', () => {
  for (const p of saved.publications) {
    assert.ok(p.publishedAt && p.note && p.basedOn.recordCount > 0);
    assert.ok(p.basedOn.recordIds.includes('R-GB01') || p.version === 1);
  }
});
