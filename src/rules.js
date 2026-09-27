// 当届竞赛规则集。规则随版本固化,改规则等于换一版规则对象,
// 历史版本始终引用发布时所用的规则编号,保证任一版本都能复算。
export const DEFAULT_RULES = {
  id: 'rules-2026-v1',
  name: '全国女排锦标赛晋级规则(2026 示例版)',
  // 积分办法:3:0/3:1 胜者 3 分;3:2 胜者 2 分、负者 1 分
  scoring: { straightSetsWinner: 3, fiveSetsWinner: 2, fiveSetsLoser: 1 },
  // 组内顺位:积分 → 胜场 → 胜负局比率 → 得失分比率 → 相互间成绩 → 抽签
  group_tiebreakers: ['points', 'wins', 'setRatio', 'pointRatio', 'headToHead'],
  // 跨组第三名比较:不同组的队伍没有相互比赛,不用 headToHead
  third_place_tiebreakers: ['points', 'wins', 'setRatio', 'pointRatio'],
  // 八强排签:按小组赛整体战绩,同样不涉及跨组相互成绩
  seeding_tiebreakers: ['points', 'wins', 'setRatio', 'pointRatio'],
  // 晋级名额:各组前两名 + 成绩最好的两个小组第三
  advance: { group_top: 2, best_thirds: 2 },
  // 四分之一决赛固定交叉对阵(按签位)
  bracket: [[1, 8], [4, 5], [3, 6], [2, 7]],
};

export function validateRules(rules) {
  const need = ['id', 'scoring', 'group_tiebreakers', 'third_place_tiebreakers', 'seeding_tiebreakers', 'advance', 'bracket'];
  for (const key of need) {
    if (!(key in rules)) throw new Error(`规则缺少字段: ${key}`);
  }
  const known = new Set(['points', 'wins', 'setRatio', 'pointRatio', 'headToHead']);
  for (const chain of [rules.group_tiebreakers, rules.third_place_tiebreakers, rules.seeding_tiebreakers]) {
    for (const c of chain) {
      if (!known.has(c)) throw new Error(`未知排名准则: ${c}`);
    }
  }
  if (rules.third_place_tiebreakers.includes('headToHead') || rules.seeding_tiebreakers.includes('headToHead')) {
    throw new Error('跨组比较不得使用相互间成绩');
  }
  if (rules.advance.group_top < 1 || rules.advance.best_thirds < 0) throw new Error('晋级名额无效');
  const seats = new Set(rules.bracket.flat());
  if (seats.size !== 8) throw new Error('对阵表须覆盖一至八号签');
  return rules;
}
