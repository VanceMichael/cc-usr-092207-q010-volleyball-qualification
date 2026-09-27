// 晋级与签位:各组前两名直接晋级,小组第三名跨组比较取成绩最好的两支,
// 八支晋级队按小组赛战绩排一至八号签,再按规则给定的固定对阵表落位。
import { rankRows } from './standings.js';

export function computeAdvancement(standings, rules, results) {
  const direct = [];
  const thirdCandidates = [];
  for (const { group, rows } of standings) {
    rows.forEach((row, i) => {
      if (i < rules.advance.group_top) {
        direct.push({ ...row, group, groupRank: i + 1, path: 'group-top' });
      } else if (i === rules.advance.group_top) {
        thirdCandidates.push({ ...row, group, groupRank: i + 1 });
      }
    });
  }

  // 跨组第三名比较(各组规模不同,比较链由规则显式给出,不用相互间成绩)
  const thirdRanked = rankRows(thirdCandidates, rules.third_place_tiebreakers, results, rules.scoring);
  const bestThirds = thirdRanked.rows
    .slice(0, rules.advance.best_thirds)
    .map((row) => ({ ...row, path: 'best-third' }));

  const qualifiers = [...direct, ...bestThirds];
  const seeded = rankRows(qualifiers, rules.seeding_tiebreakers, results, rules.scoring);
  const seeds = seeded.rows.map((row, i) => ({
    seed: i + 1, team: row.team, group: row.group, path: row.path, row,
  }));

  const bracket = rules.bracket.map((pair, i) => ({
    slot: `QF${i + 1}`,
    seeds: pair,
    home: seeds[pair[0] - 1].team,
    away: seeds[pair[1] - 1].team,
  }));

  return {
    direct,
    thirds: {
      rows: thirdRanked.rows,
      decisions: thirdRanked.decisions,
      advanced: bestThirds.map((r) => r.team),
    },
    seeds,
    seedDecisions: seeded.decisions,
    bracket,
  };
}
