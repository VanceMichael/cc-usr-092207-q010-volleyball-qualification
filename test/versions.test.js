import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLedger, appendRecords, appendRecord } from '../src/records.js';
import { DEFAULT_RULES } from '../src/rules.js';
import { publishVersion, diffVersions, publicView } from '../src/versions.js';
import { explainTeam, explainDiff, explainVersion } from '../src/explain.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/tournament.json', import.meta.url), 'utf8'));
const rules = DEFAULT_RULES;
const baseLedger = appendRecords(createLedger(), fixture.records);

const v1 = publishVersion({
  fixture, ledger: baseLedger, rules, published_at: '2026-09-20T10:00:00+08:00',
});

test('首版发布:签位、对阵、发布时间完整', () => {
  assert.equal(v1.version, 1);
  assert.equal(v1.rules_id, 'rules-2026-v1');
  assert.deepEqual(v1.advancement.seeds.map((s) => s.team), ['B1', 'A1', 'C1', 'B2', 'A2', 'A3', 'B3', 'C2']);
  assert.deepEqual(v1.bracket.map((s) => [s.home, s.away]), [['B1', 'C2'], ['B2', 'A2'], ['C1', 'A3'], ['A1', 'B3']]);
  assert.equal(v1.conflicts.length, 0);
  const view = publicView(v1);
  assert.equal(view.published_at, '2026-09-20T10:00:00+08:00');
  assert.equal(view.seeds.length, 8);
});

test('处罚扣分发布新版本:未开赛对阵重排,影响可解释', () => {
  const ledger2 = appendRecord(baseLedger, {
    record_id: 'P-001', kind: 'penalty', penalty: { team: 'B3', points: -5 },
    reason: '纪律处罚:赛后追罚', status: 'confirmed', confirmed_by: '竞赛委员会',
    recorded_at: '2026-09-21T09:00:00+08:00',
  });
  const v2 = publishVersion({
    fixture, ledger: ledger2, rules, previous: v1, published_at: '2026-09-21T12:00:00+08:00',
  });
  assert.equal(v2.version, 2);
  // B3 积分 7→2,被 C3(3 分)挤出最佳第三名
  assert.deepEqual(v2.advancement.thirds.advanced, ['A3', 'C3']);
  assert.deepEqual(v2.advancement.seeds.map((s) => s.team), ['B1', 'A1', 'C1', 'B2', 'A2', 'A3', 'C2', 'C3']);
  // 未开赛,允许重排:QF1、QF4 换队,QF2、QF3 不变
  assert.deepEqual(v2.rearranged, ['QF1', 'QF4']);
  assert.equal(v2.conflicts.length, 0);
  assert.deepEqual(v2.bracket.map((s) => [s.home, s.away]), [['B1', 'C3'], ['B2', 'A2'], ['C1', 'A3'], ['A1', 'C2']]);

  const diff = diffVersions(v1, v2);
  assert.deepEqual(diff.newRecords, ['P-001']);
  const byTeam = Object.fromEntries(diff.changes.map((c) => [c.team, c]));
  assert.equal(byTeam.C3.type, 'advanced');
  assert.equal(byTeam.B3.type, 'eliminated');
  assert.equal(byTeam.B3.wasSeed, 7);
  assert.deepEqual([byTeam.C2.from, byTeam.C2.to], [8, 7]);

  const text = explainDiff(v1, v2).join('\n');
  assert.match(text, /P-001/);
  assert.match(text, /苍梧队 由第 7 号签变为未晋级/);
  assert.match(text, /雁回队 由未晋级变为晋级,落第 8 号签/);
});

test('已开赛的签位必须锁定,冲突留待裁定;其余对阵重排', () => {
  // 申诉改判:C1 对 C2 改判为 C2 3:0 获胜
  const ledger3 = appendRecord(baseLedger, {
    record_id: 'R-C-01b', match_id: 'M-C-01', kind: 'overturn', supersedes: 'R-C-01',
    stage: 'group', group: 'C', teams: ['C1', 'C2'], sets: [[21, 25], [23, 25], [20, 25]],
    roster_objection: false, status: 'confirmed', confirmed_by: '仲裁委员会',
    recorded_at: '2026-09-22T10:00:00+08:00', reason: '申诉成立,改判 C2 3:0 获胜',
  });
  const v2 = publishVersion({
    fixture, ledger: ledger3, rules, previous: v1,
    knockoutStates: { QF1: 'started' }, published_at: '2026-09-22T12:00:00+08:00',
  });
  // 改判后 C2 积 9 分列三号签,C1 落到八号签:QF1 按新结果应为 B1 对 C1
  assert.equal(v2.conflicts.length, 1);
  assert.equal(v2.conflicts[0].slot, 'QF1');
  assert.deepEqual(v2.conflicts[0].kept, { home: 'B1', away: 'C2' });
  assert.deepEqual(v2.conflicts[0].computed, { home: 'B1', away: 'C1' });
  const qf1 = v2.bracket.find((s) => s.slot === 'QF1');
  assert.equal(qf1.locked, true);
  assert.deepEqual([qf1.home, qf1.away], ['B1', 'C2']);
  // QF3 未开赛,按新签位重排为 C2 对 A3
  assert.deepEqual(v2.rearranged, ['QF3']);
  const qf3 = v2.bracket.find((s) => s.slot === 'QF3');
  assert.deepEqual([qf3.home, qf3.away], ['C2', 'A3']);

  const text = explainDiff(v1, v2).join('\n');
  assert.match(text, /QF1 已开赛,签位锁定为 绛河队 对 锦屏队/);
  assert.match(text, /按新结果应为 绛河队 对 澜沧队/);
});

test('解释:某队为何晋级、为何落在该签位', () => {
  const a3 = explainTeam(v1, 'A3').join('\n');
  assert.match(a3, /望海队 在 A 组出战 4 场,2 胜 2 负,积分 7/);
  assert.match(a3, /列小组第 3 名/);
  assert.match(a3, /得失分比率 333:321 对 329:320,故排其前/);
  assert.match(a3, /以成绩最好的第三名晋级八强/);
  assert.match(a3, /第 6 号签/);
  assert.match(a3, /QF3:澜沧队 对 望海队/);

  const c3 = explainTeam(v1, 'C3').join('\n');
  assert.match(c3, /在小组第三名中未能进入前二,止步小组赛/);

  const b2 = explainTeam(v1, 'B2').join('\n');
  assert.match(b2, /作为 B 组前 2 名直接晋级八强/);
  assert.match(b2, /第 4 号签/);
  assert.match(b2, /得失分比率 369:338 对 368:352,故排其前/);

  const overview = explainVersion(v1).join('\n');
  assert.match(overview, /第 1 版,发布时间 2026-09-20T10:00:00\+08:00/);
  assert.match(overview, /第 1 号签:绛河队/);
});
