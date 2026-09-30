// 跨组晋级、八强排签与四分之一决赛对阵。
//
// 三个小组人数不同（5/5/4）：
//   - 各组前两名直接晋级；
//   - 三个第三名按当届规程做“归一化”比较——5 队组剔除与本组垫底队的
//     全部对赛成绩，4 队组成绩照用，再按积分/胜场/C 值/Z 值/抽签排序，
//     取前两名；
//   - 八强排签沿用同一归一化口径，保证 4 队组与 5 队组可比；
//   - 签位 1..8 按规则表生成固定交叉的四场四分之一决赛。

import { RULES } from './rules.js';
import {
  groupMatches,
  makeHeadToHeadWinner,
  rankCandidates,
  teamStats,
} from './standings.js';

// 计算一个小组：组内排名 + 每名次行 + 归一化统计（剔除垫底队）。
export function evaluateGroup(state, group) {
  const teamIds = group.teams ?? group.teamIds;
  const matches = groupMatches(state, group.matchIds);
  const stats = teamIds.map((t) => teamStats(state, t, matches));

  const ranking = rankCandidates(stats, {
    state,
    stage: `group:${group.id}`,
    headToHead: true,
    headToHeadWinner: makeHeadToHeadWinner(matches),
    restrictedStats: (teamIds) => {
      // 平分集团内部小循环
      const inside = new Set(teamIds);
      return teamIds.map((t) => teamStats(state, t, matches.filter((m) => inside.has(m.home) && inside.has(m.away))));
    },
  });

  const last = ranking.order.at(-1).team;
  const normalized = new Map(
    teamIds.map((t) => [
      t,
      teamStats(state, t, matches, teamIds.length === 5 ? new Set([last]) : null),
    ])
  );

  return {
    group,
    matches,
    order: ranking.order,
    pendingDraws: ranking.pendingDraws,
    last,
    placement: new Map(ranking.order.map((r, i) => [r.team, i + 1])),
    normalized,
  };
}

// 全量重算：组内顺位 → 第三名比较 → 排签 → QF。
export function evaluate(tournament, state) {
  const groupResults = tournament.groups.map((g) => evaluateGroup(state, g));
  const groupById = new Map(groupResults.map((r) => [r.group.id, r]));

  const qualifiers = []; // { team, group, placement, direct }
  for (const gr of groupResults) {
    for (const row of gr.order.slice(0, 2)) {
      qualifiers.push({ team: row.team, group: gr.group.id, placement: row.placement ?? row.rank, direct: true });
    }
  }

  // 三个第三名的跨组比较（归一化口径）
  const thirdRows = groupResults.map((gr) => {
    const row = gr.order[2];
    const norm = gr.normalized.get(row.team);
    return { ...norm, group: gr.group.id };
  });
  const thirdRanking = rankCandidates(thirdRows, {
    state,
    stage: 'third',
    headToHead: false,
  });

  const thirdPlace = thirdRanking.order.map((r, i) => ({
    team: r.team,
    group: r.group,
    placement: 3,
    direct: false,
    normalized: true,
    rankAmongThirds: i + 1,
    qualified: i < RULES.thirdPlace.qualify,
    decidedBy: r.decidedBy,
    stats: (({ points, matchPoints, penaltyPoints, wins, played, sw, sl, spw, spl, setRatio, pointRatio }) => ({
      points, matchPoints, penaltyPoints, wins, played, sw, sl, spw, spl, setRatio, pointRatio,
    }))(r),
  }));

  for (const tp of thirdPlace.filter((t) => t.qualified)) {
    qualifiers.push({ team: tp.team, group: tp.group, placement: 3, direct: false });
  }

  // 排签：所有晋级队按归一化小组赛战绩排序
  const seedRows = qualifiers.map((q) => {
    const gr = groupById.get(q.group);
    const norm = gr.normalized.get(q.team);
    return { ...norm, group: q.group, placement: q.placement };
  });
  const seedRanking = rankCandidates(seedRows, { state, stage: 'seed', headToHead: false });
  const seeds = seedRanking.order.map((r, i) => ({
    seed: i + 1,
    team: r.team,
    group: r.group,
    placement: r.placement,
    points: r.points,
    wins: r.wins,
    setRatio: r.setRatio,
    pointRatio: r.pointRatio,
    decidedBy: r.decidedBy,
  }));
  const seedOf = new Map(seeds.map((s) => [s.team, s.seed]));

  // 固定交叉四分之一决赛
  const quarterfinals = RULES.knockout.quarterfinals.map((slot) => {
    const home = seeds.find((s) => s.seed === slot.homeSeed)?.team ?? null;
    const away = seeds.find((s) => s.seed === slot.awaySeed)?.team ?? null;
    return {
      matchId: slot.matchId,
      homeSeed: slot.homeSeed,
      awaySeed: slot.awaySeed,
      home,
      away,
      kickedOff: state.kicks.has(slot.matchId),
      kickoffTs: state.kicks.get(slot.matchId)?.ts ?? null,
      hasResult: state.matches.has(slot.matchId),
    };
  });

  return {
    rules: RULES.edition,
    groups: groupResults,
    thirdPlace,
    qualifiers,
    eliminatedThirds: thirdPlace.filter((t) => !t.qualified),
    seeds,
    seedOf,
    quarterfinals,
    pendingDraws: [
      ...groupResults.flatMap((g) => g.pendingDraws),
      ...thirdRanking.pendingDraws,
      ...seedRanking.pendingDraws,
    ],
  };
}
