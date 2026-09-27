import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLedger, appendRecord, appendRecords, effectiveRecords, teamRecords,
} from '../src/records.js';

const baseResult = {
  record_id: 'R-001', match_id: 'M-001', kind: 'result', stage: 'group', group: 'A',
  teams: ['X', 'Y'], sets: [[25, 20], [25, 21], [25, 23]],
  roster_objection: false, status: 'confirmed', confirmed_by: '技术代表(值班)',
  recorded_at: '2026-09-14T12:00:00+08:00', supersedes: null, reason: null,
};

test('账本只增不改:追加返回新账本,记录被冻结', () => {
  const l0 = createLedger();
  const l1 = appendRecord(l0, baseResult);
  assert.equal(l0.records.length, 0);
  assert.equal(l1.records.length, 1);
  assert.ok(Object.isFrozen(l1.records[0]));
  assert.ok(Object.isFrozen(l1.records[0].sets));
});

test('记录编号不得重复,改判必须指向已存在的记录', () => {
  const l1 = appendRecord(createLedger(), baseResult);
  assert.throws(() => appendRecord(l1, { ...baseResult }), /记录编号重复/);
  assert.throws(
    () => appendRecord(l1, { ...baseResult, record_id: 'R-002', kind: 'overturn', supersedes: 'R-999' }),
    /被取代的记录不存在/,
  );
  assert.throws(
    () => appendRecord(l1, { ...baseResult, record_id: 'R-002', kind: 'overturn', supersedes: null }),
    /supersedes/,
  );
});

test('比分校验:局数、净胜分、结束后不得续登', () => {
  const l0 = createLedger();
  assert.throws(() => appendRecord(l0, { ...baseResult, sets: [[25, 20], [25, 20]] }), /局数/);
  assert.throws(() => appendRecord(l0, { ...baseResult, sets: [[25, 24], [25, 20], [25, 20]] }), /比分无效/);
  assert.throws(
    () => appendRecord(l0, { ...baseResult, sets: [[25, 20], [25, 20], [25, 20], [25, 20]] }),
    /不得继续/,
  );
  assert.throws(
    () => appendRecord(l0, { ...baseResult, sets: [[25, 20], [20, 25], [25, 20], [20, 25], [14, 12]] }),
    /比分无效/, // 决胜局为 15 分制
  );
});

test('改判以新记录取代旧记录,旧记录仍留档', () => {
  let ledger = appendRecord(createLedger(), baseResult);
  ledger = appendRecord(ledger, {
    ...baseResult,
    record_id: 'R-001b', kind: 'overturn', supersedes: 'R-001',
    sets: [[20, 25], [21, 25], [23, 25]], reason: '申诉成立,改判 Y 队 3:0 获胜',
    recorded_at: '2026-09-15T09:00:00+08:00',
  });
  assert.equal(ledger.records.length, 2);
  const { results } = effectiveRecords(ledger);
  assert.equal(results.length, 1);
  assert.equal(results[0].record_id, 'R-001b');
  assert.deepEqual(results[0].sets[0], [20, 25]);
});

test('待确认记录不参与计算;球队可核对自己的全部原始记录', () => {
  let ledger = appendRecord(createLedger(), { ...baseResult, status: 'pending', confirmed_by: undefined });
  assert.equal(effectiveRecords(ledger).results.length, 0);
  ledger = appendRecord(ledger, {
    record_id: 'P-001', kind: 'penalty', penalty: { team: 'X', points: -2 },
    reason: '纪律处罚', status: 'confirmed', confirmed_by: '竞赛委员会',
    recorded_at: '2026-09-16T09:00:00+08:00',
  });
  const mine = teamRecords(ledger, 'X');
  assert.equal(mine.length, 2);
  assert.ok(mine.some((r) => r.kind === 'penalty'));
});

test('处罚与弃权记录的必填项', () => {
  const l0 = createLedger();
  assert.throws(() => appendRecord(l0, {
    record_id: 'P-002', kind: 'penalty', penalty: { team: 'X' },
    reason: '纪律处罚', status: 'confirmed', confirmed_by: '竞赛委员会', recorded_at: '2026-09-16T09:00:00+08:00',
  }), /扣分/);
  assert.throws(() => appendRecord(l0, {
    ...baseResult, record_id: 'R-009', kind: 'forfeit', forfeit_by: 'Z',
    sets: [[25, 0], [25, 0], [25, 0]], reason: '弃权',
  }), /弃权方/);
});

test('appendRecords 批量装载', () => {
  const ledger = appendRecords(createLedger(), [
    baseResult,
    { ...baseResult, record_id: 'R-002', match_id: 'M-002' },
  ]);
  assert.equal(ledger.records.length, 2);
  assert.equal(ledger.records[1].seq, 2);
});
