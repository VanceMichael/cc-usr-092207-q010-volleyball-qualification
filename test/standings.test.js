import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLedger, appendRecords } from '../src/records.js';
import { DEFAULT_RULES, validateRules } from '../src/rules.js';
import { computeStandings, rankRows } from '../src/standings.js';
import { computeTournament } from '../src/versions.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/tournament.json', import.meta.url), 'utf8'));
const rules = validateRules(DEFAULT_RULES);
const ledger = appendRecords(createLedger(), fixture.records);
const { standings, advancement } = computeTournament(fixture, ledger, rules);

test('组内顺位:积分、胜场、局分、得分统计正确', () => {
  const [a, b, c] = standings;
  assert.deepEqual(a.rows.map((r) => r.team), ['A1', 'A2', 'A3', 'A4', 'A5']);
  assert.deepEqual(a.rows.map((r) => r.points), [12, 8, 7, 2, 1]);
  assert.deepEqual(b.rows.map((r) => r.team), ['B1', 'B2', 'B3', 'B4', 'B5']);
  assert.deepEqual(b.rows.map((r) => r.points), [12, 8, 7, 3, 0]);
  assert.deepEqual(c.rows.map((r) => r.team), ['C1', 'C2', 'C3', 'C4']);
  assert.deepEqual(c.rows.map((r) => r.points), [9, 6, 3, 0]);
});

test('弃权按 0:3 记录并计入统计', () => {
  const c = standings.find((g) => g.group === 'C');
  const c1 = c.rows.find((r) => r.team === 'C1');
  assert.equal(c1.setsWon, 9);
  assert.equal(c1.setsLost, 0);
  const c4 = c.rows.find((r) => r.team === 'C4');
  assert.equal(c4.points, 0);
  assert.equal(c4.played, 3);
});

test('跨组第三名比较:积分、胜场、局比率相同,按得失分比率分出先后', () => {
  const thirds = advancement.thirds;
  assert.deepEqual(thirds.rows.map((r) => r.team), ['A3', 'B3', 'C3']);
  assert.deepEqual(thirds.advanced, ['A3', 'B3']);
  // A3 与 B3 积分同为 7、胜场同为 2、局比率同为 8:7,由得失分比率决定
  assert.equal(thirds.decisions[0].criterion, 'pointRatio');
  assert.equal(thirds.decisions[0].aText, '333:321');
  assert.equal(thirds.decisions[0].bText, '329:320');
  assert.equal(thirds.decisions[1].criterion, 'points');
});

test('八强排签与固定交叉对阵', () => {
  assert.deepEqual(
    advancement.seeds.map((s) => s.team),
    ['B1', 'A1', 'C1', 'B2', 'A2', 'A3', 'B3', 'C2'],
  );
  // B1 与 A1 同为 12 分 4 胜 12:1 局,由得失分比率决定一、二号签
  const top = advancement.seedDecisions[0];
  assert.equal(top.criterion, 'pointRatio');
  assert.deepEqual(
    advancement.bracket.map((s) => [s.home, s.away]),
    [['B1', 'C2'], ['B2', 'A2'], ['C1', 'A3'], ['A1', 'B3']],
  );
});

test('相互间成绩:链前各级均并列时按相互战绩排名', () => {
  const rows = [
    { team: 'X', points: 5, wins: 2, setsWon: 7, setsLost: 5, pointsWon: 300, pointsLost: 300 },
    { team: 'Y', points: 5, wins: 2, setsWon: 7, setsLost: 5, pointsWon: 300, pointsLost: 300 },
  ];
  const results = [{ teams: ['X', 'Y'], sets: [[25, 20], [25, 20], [25, 20]] }];
  const { rows: ordered, decisions } = rankRows(rows, rules.group_tiebreakers, results, rules.scoring);
  assert.deepEqual(ordered.map((r) => r.team), ['X', 'Y']);
  assert.equal(decisions[0].criterion, 'headToHead');
});

test('完全并列且无相互比赛时记为抽签落位', () => {
  const rows = [
    { team: 'Y', points: 3, wins: 1, setsWon: 3, setsLost: 2, pointsWon: 100, pointsLost: 100 },
    { team: 'X', points: 3, wins: 1, setsWon: 3, setsLost: 2, pointsWon: 100, pointsLost: 100 },
  ];
  const { rows: ordered, decisions } = rankRows(rows, rules.group_tiebreakers, [], rules.scoring);
  assert.deepEqual(ordered.map((r) => r.team), ['X', 'Y']);
  assert.equal(decisions[0].criterion, 'lot');
});

test('规则校验:跨组比较不得使用相互间成绩', () => {
  assert.throws(
    () => validateRules({ ...DEFAULT_RULES, third_place_tiebreakers: ['points', 'headToHead'] }),
    /相互间成绩/,
  );
});
