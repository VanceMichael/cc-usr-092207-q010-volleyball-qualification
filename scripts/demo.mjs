// 演示:小组赛果 → 首版发布 → 处罚扣分 → 改判与开赛锁定。
import { readFile } from 'node:fs/promises';
import { createLedger, appendRecords, appendRecord } from '../src/records.js';
import { DEFAULT_RULES } from '../src/rules.js';
import { publishVersion } from '../src/versions.js';
import { explainTeam, explainDiff, explainVersion } from '../src/explain.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/tournament.json', import.meta.url), 'utf8'));
const ledger = appendRecords(createLedger(), fixture.records);

const v1 = publishVersion({
  fixture, ledger, rules: DEFAULT_RULES, published_at: '2026-09-20T10:00:00+08:00',
});
console.log('========== 首版发布 ==========');
console.log(explainVersion(v1).join('\n'));
console.log('\n---------- 望海队(A3)为何晋级 ----------');
console.log(explainTeam(v1, 'A3').join('\n'));

// 处罚扣分:苍梧队(B3)被追罚 5 分
const ledger2 = appendRecord(ledger, {
  record_id: 'P-001', kind: 'penalty', penalty: { team: 'B3', points: -5 },
  reason: '纪律处罚:赛后追罚', status: 'confirmed', confirmed_by: '竞赛委员会',
  recorded_at: '2026-09-21T09:00:00+08:00',
});
const v2 = publishVersion({
  fixture, ledger: ledger2, rules: DEFAULT_RULES, previous: v1, published_at: '2026-09-21T12:00:00+08:00',
});
console.log('\n========== 处罚扣分后发布第二版 ==========');
console.log(explainDiff(v1, v2).join('\n'));

// 申诉改判,且 QF1 已经开赛
const ledger3 = appendRecord(ledger, {
  record_id: 'R-C-01b', match_id: 'M-C-01', kind: 'overturn', supersedes: 'R-C-01',
  stage: 'group', group: 'C', teams: ['C1', 'C2'], sets: [[21, 25], [23, 25], [20, 25]],
  roster_objection: false, status: 'confirmed', confirmed_by: '仲裁委员会',
  recorded_at: '2026-09-22T10:00:00+08:00', reason: '申诉成立,改判 C2 3:0 获胜',
});
const v3 = publishVersion({
  fixture, ledger: ledger3, rules: DEFAULT_RULES, previous: v1,
  knockoutStates: { QF1: 'started' }, published_at: '2026-09-22T12:00:00+08:00',
});
console.log('\n========== 申诉改判且 QF1 已开赛 ==========');
console.log(explainDiff(v1, v3).join('\n'));
