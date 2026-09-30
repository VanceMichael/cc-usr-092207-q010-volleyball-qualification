// 当届规则（以 2025 年全国女排锦标赛竞委会办法为蓝本，全部作为数据，
// 换届时只改本文件/配置，不改计算代码）。
//
// 排名口径（FIVB 一般规则 → 当届规程）：
//   积分 → 胜场 → C 值（局分比）→ Z 值（得分比）→ 相互间 → 抽签
// 两个并列集团之间若能靠相互间分出高下，则在抽签之前优先采用；
// 三队（含）以上平分时相互间不能整体判定，回退到抽签，
// 抽签结果以裁判/技术代表确认的记录固化。

export const RULES = Object.freeze({
  edition: {
    code: '2025-national-women-volleyball-championship',
    name: '二〇二五年全国女排锦标赛',
  },

  // 小组赛积分
  points: Object.freeze({
    win30or31: 3, // 3:0 或 3:1 胜
    lose30or31: 0,
    win32: 2, // 3:2 胜
    lose32: 1,
    // 弃权：弃权方 0:3 告负，每局记 0:25；被弃权方正常取 3 分
    forfeitLoser: 0,
    forfeitWinner: 3,
  }),

  // 组内排名依据，按顺序应用
  standingCriteria: Object.freeze([
    'points', // 1. 积分
    'wins', // 2. 胜场
    'setRatio', // 3. C 值 = 胜局/负局
    'pointRatio', // 4. Z 值 = 得分/失分
    'headToHead', // 5. 相互间（仅两强时可直接判定）
    'draw', // 6. 抽签（记录确认结果）
  ]),

  // 跨组比较第三名：5 队组去掉与本组垫底队的全部对赛成绩后，
  // 按与组内相同的顺序比较
  thirdPlace: Object.freeze({
    qualify: 2,
    normalizeAgainstLast: true,
    criteria: Object.freeze(['points', 'wins', 'setRatio', 'pointRatio', 'draw']),
  }),

  // 八强排签：按小组赛（跨组比较时使用归一化口径）同一套指标排序
  seeding: Object.freeze({
    criteria: Object.freeze(['points', 'wins', 'setRatio', 'pointRatio', 'draw']),
  }),

  // 固定交叉淘汰对阵（号位 1..8）
  knockout: Object.freeze({
    quarterfinals: Object.freeze([
      { matchId: 'QF1', homeSeed: 1, awaySeed: 8 },
      { matchId: 'QF2', homeSeed: 4, awaySeed: 5 },
      { matchId: 'QF3', homeSeed: 3, awaySeed: 6 },
      { matchId: 'QF4', homeSeed: 2, awaySeed: 7 },
    ]),
  }),

  // 锁定条款：淘汰赛一经开赛，其对阵（及因此确定的签位）锁定；
  // 未开赛的比赛允许在修正发布后重排。
  lock: Object.freeze({
    onKickoff: 'quarterfinalFixtureLocked',
  }),
});
