import test from 'node:test';
import assert from 'node:assert/strict';
import { matchEvent, miniTournament } from './util.js';
import { replay } from '../src/records.js';
import { evaluateGroup } from '../src/qualification.js';
import { rankCandidates } from '../src/standings.js';

// 构造一个单循环：teamIds 先排序，键 "X-Y" 永远以字典序较小者 X 为视角，
// value=[X胜局,Y胜局]。比分由确定性规则生成。
function roundRobin(teamIds, results, groupId = 'X') {
  const teams = [...teamIds].sort();
  const events = [];
  const matchIds = [];
  let day = 10;
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i];
      const b = teams[j];
      const r = results[`${a}-${b}`];
      if (!r) continue;
      const [aWinsSet, bWinsSet] = r;
      const games = aWinsSet + bWinsSet;
      const aLosesGames = games === 3 ? [] : games === 4 ? [2] : [2, 3]; // 0-based
      const sets = Array.from({ length: games }, (_, gi) => {
        const deciding = gi === 4;
        const w = deciding ? 15 : 25;
        const l = deciding ? 12 : 17 + ((gi * 5) % 7);
        const aTakes = aWinsSet === 3 ? !aLosesGames.includes(gi) : aLosesGames.includes(gi);
        return aTakes ? [w, l] : [l, w];
      });
      const matchId = `M-${a}-${b}`;
      matchIds.push(matchId);
      events.push(
        matchEvent({
          matchId,
          home: a,
          away: b,
          ts: `2025-09-${day}T10:00:00+08:00`,
          sets,
          group: groupId,
        })
      );
      day += 1;
    }
  }
  const tournament = miniTournament([{ id: groupId, name: groupId, teamIds: teams, matchIds }]);
  const state = replay(events, { teamsById: new Set(teams) });
  return { tournament, state, group: tournament.groups[0] };
}

test('积分：3:0/3:1 胜 3 分、3:2 胜 2 负 1，处罚扣分作用于积分', () => {
  const { state, group } = roundRobin(['A', 'B', 'C', 'D'], {
    'A-B': [3, 1],
    'A-C': [3, 0],
    'A-D': [3, 2],
    'B-C': [3, 0],
    'B-D': [3, 1],
    'C-D': [3, 2],
  });
  const r = evaluateGroup(state, group);
  const row = (t) => r.order.find((x) => x.team === t);
  assert.equal(row('A').points, 8); // 3（3:1）+3（3:0）+2（3:2）
  assert.equal(row('B').points, 6); // 0+3+3
  assert.equal(row('C').points, 2); // 0+0+2（3:2 胜 D）
  assert.equal(row('D').points, 2); // 1+0+1（两个 2:3 负各 1 分）
  assert.ok(row('C').wins > row('D').wins); // 同分先比胜场

  state.penalties.set('PEN-X', {
    penalty: { id: 'PEN-X', type: 'penalty', ts: 't', team: 'C', points: 2, reason: 'x' },
    reversedBy: null,
  });
  const r2 = evaluateGroup(state, group);
  assert.equal(r2.order.find((x) => x.team === 'C').points, 0); // 2 - 2
});

test('积分与胜场相同：C 值高者列前', () => {
  // A、B 均 2 胜 6 分：A 为 3:0+3:1 取胜、1:3 负 D（胜局 7 负 4）；
  // B 为 3:1+3:0 取胜、0:3 负 A（胜局 6 负 4）→ A 的 C 值更高。
  const { state, group } = roundRobin(['A', 'B', 'C', 'D'], {
    'A-B': [3, 0],
    'A-C': [3, 1],
    'A-D': [1, 3],
    'B-C': [3, 1],
    'B-D': [3, 0],
    'C-D': [3, 0],
  });
  const r = evaluateGroup(state, group);
  assert.deepEqual(r.order.map((x) => x.team), ['A', 'B', 'C', 'D']);
  assert.equal(r.order[0].decidedBy, 'setRatio');
  assert.equal(r.order[1].decidedBy, 'setRatio');
});

test('两队积分/胜场/C值/Z值全同：相互间胜负定先后', () => {
  const tied = (team) => ({
    team, played: 3, wins: 2, matchPoints: 8, penaltyPoints: 0, points: 8,
    sw: 6, sl: 3, spw: 200, spl: 180,
  });
  const worse = { team: 'C', played: 3, wins: 0, matchPoints: 0, penaltyPoints: 0, points: 0, sw: 1, sl: 9, spw: 150, spl: 230 };
  const { order, pendingDraws } = rankCandidates([tied('A'), tied('B'), worse], {
    state: replay([], { teamsById: new Set(['A', 'B', 'C']) }),
    stage: 'group:X',
    headToHead: true,
    headToHeadWinner: (a, b) => (a === 'A' && b === 'B' ? 'A' : null),
  });
  assert.deepEqual(order.map((x) => x.team), ['A', 'B', 'C']);
  assert.equal(order[0].decidedBy, 'headToHead');
  assert.equal(order[1].decidedBy, 'headToHead');
  assert.equal(pendingDraws.length, 0);
});

test('C 值相同看 Z 值；三队平分小循环 C 值可区分则不抽签', () => {
  const row = (team, sw, sl, spw, spl) => ({
    team, played: 3, wins: 2, matchPoints: 7, penaltyPoints: 0, points: 7, sw, sl, spw, spl,
  });
  // A、B 的 C 值相同（6:3），Z 值 A 更高
  const z = rankCandidates(
    [row('A', 6, 3, 210, 170), row('B', 6, 3, 200, 180)],
    { state: replay([], { teamsById: new Set(['A', 'B']) }), stage: 'third', headToHead: false }
  );
  assert.deepEqual(z.order.map((x) => x.team), ['A', 'B']);
  assert.equal(z.order[0].decidedBy, 'pointRatio');

  // 三队平分，小循环统计在 C 值这一级可区分
  const base = row;
  const state = replay([], { teamsById: new Set(['A', 'B', 'C']) });
  const split = rankCandidates([base('A', 6, 3, 200, 190), base('B', 6, 3, 200, 190), base('C', 6, 3, 200, 190)], {
    state,
    stage: 'group:Y',
    headToHead: true,
    headToHeadWinner: () => null,
    restrictedStats: (ids) =>
      ids.map((t) => ({
        team: t, played: 2, wins: 1, matchPoints: 3, penaltyPoints: 0, points: 3,
        sw: t === 'A' ? 6 : t === 'B' ? 5 : 4,
        sl: t === 'A' ? 2 : t === 'B' ? 3 : 4,
        spw: 100, spl: 90,
      })),
  });
  assert.equal(split.pendingDraws.length, 0);
  assert.deepEqual(split.order.map((x) => x.team), ['A', 'B', 'C']);
  assert.ok(split.order.every((x) => x.restricted));
  assert.equal(split.order[0].decidedBy, 'setRatio');
});

test('三队连环且全部指标相同：小循环仍不可分 → 抽签；确认后顺位固化', () => {
  const { state, group } = roundRobin(['A', 'B', 'C', 'D'], {
    'A-B': [3, 0],
    'A-C': [0, 3],
    'A-D': [3, 0],
    'B-C': [3, 0],
    'B-D': [3, 0],
    'C-D': [3, 0],
  });
  const r = evaluateGroup(state, group);
  assert.equal(r.pendingDraws.length, 1);
  assert.deepEqual([...r.pendingDraws[0].teams].sort(), ['A', 'B', 'C']);

  state.draws.push({
    id: 'D1',
    type: 'drawOutcome',
    ts: '2025-09-20T20:00:00+08:00',
    stage: 'group:X',
    tieKey: r.pendingDraws[0].tieKey,
    teams: ['C', 'A', 'B'],
    confirmedBy: { technicalDelegate: 'TD-1' },
  });
  const r2 = evaluateGroup(state, group);
  assert.deepEqual(r2.order.slice(0, 3).map((x) => x.team), ['C', 'A', 'B']);
  assert.equal(r2.order[0].decidedBy, 'draw');
});

test('跨组第三名归一化：5 队组剔除与垫底队的对赛后再比较', () => {
  const teams = ['A', 'B', 'C', 'D', 'E'];
  const events = [];
  const matchIds = [];
  const add = (id, home, away, sets) => {
    matchIds.push(id);
    events.push(
      matchEvent({ matchId: id, home, away, ts: `2025-09-${10 + matchIds.length}T10:00:00+08:00`, sets, group: 'G5' })
    );
  };
  const w = [[25, 20], [25, 20], [25, 20]];
  add('M1', 'A', 'B', w);
  add('M2', 'A', 'C', w);
  add('M3', 'A', 'D', w);
  add('M4', 'A', 'E', [[20, 25], [25, 20], [25, 20], [20, 25], [15, 10]]); // A 3:2 E
  add('M5', 'B', 'C', w);
  add('M6', 'B', 'D', w);
  add('M7', 'B', 'E', w);
  add('M8', 'C', 'D', w);
  add('M9', 'C', 'E', w);
  add('M10', 'D', 'E', w);
  const tournament = miniTournament([{ id: 'G5', name: 'G5', teamIds: teams, matchIds }]);
  const state = replay(events, { teamsById: new Set(teams) });
  const r = evaluateGroup(state, tournament.groups[0]);
  assert.equal(r.order[2].team, 'C'); // 第三名
  assert.equal(r.last, 'E'); // E 全负垫底
  const normC = r.normalized.get('C');
  assert.equal(normC.played, 3); // 剔除与 E 的比赛
  assert.equal(normC.points, 3); // 对 A、B 皆负，仅胜 D
  assert.equal(normC.sw, 3);
  assert.equal(normC.sl, 6);
});
