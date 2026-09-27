// 小组积分与顺位计算。
// 排名按规则给定的比较链逐级比较;每对相邻名次都记录是哪一级准则分出的,
// 供赛后向球队与公众解释"为什么排在他前面/后面"。

export const CRITERIA = {
  points: { label: '积分', text: (r) => String(r.points) },
  wins: { label: '胜场', text: (r) => String(r.wins) },
  setRatio: { label: '胜负局比率', text: (r) => `${r.setsWon}:${r.setsLost}` },
  pointRatio: { label: '得失分比率', text: (r) => `${r.pointsWon}:${r.pointsLost}` },
  headToHead: { label: '相互间成绩', text: () => '' },
  lot: { label: '抽签', text: () => '' },
};

function criterionValue(row, c) {
  switch (c) {
    case 'points': return row.points;
    case 'wins': return row.wins;
    case 'setRatio': return { w: row.setsWon, l: row.setsLost };
    case 'pointRatio': return { w: row.pointsWon, l: row.pointsLost };
    default: throw new Error(`未知排名准则: ${c}`);
  }
}

// 比率按交叉相乘比较,避免浮点误差;分母为 0 视为"最大",且两个"最大"相等。
function compareRatio(a, b) {
  const aInf = a.l === 0;
  const bInf = b.l === 0;
  if (aInf && bInf) return 0;
  if (aInf) return 1;
  if (bInf) return -1;
  return a.w * b.l - b.w * a.l;
}

// 比较两个准则值:返回正数表示 a 靠前,0 表示并列。支持数值、比率与数组键。
export function compareValues(a, b) {
  if (typeof a === 'number') return a - b;
  if (Array.isArray(a)) {
    for (let i = 0; i < a.length; i += 1) {
      const c = compareValues(a[i], b[i]);
      if (c !== 0) return c;
    }
    return 0;
  }
  return compareRatio(a, b);
}

function blankRow(team) {
  return {
    team, played: 0, wins: 0, losses: 0, points: 0,
    setsWon: 0, setsLost: 0, pointsWon: 0, pointsLost: 0,
    penaltyPoints: 0, penalties: [],
  };
}

function applyResult(rows, r, scoring) {
  const [t1, t2] = r.teams;
  const a = rows.get(t1);
  const b = rows.get(t2);
  let sets1 = 0;
  let sets2 = 0;
  for (const [x, y] of r.sets) {
    a.pointsWon += x; a.pointsLost += y;
    b.pointsWon += y; b.pointsLost += x;
    if (x > y) { sets1 += 1; a.setsWon += 1; b.setsLost += 1; } else { sets2 += 1; b.setsWon += 1; a.setsLost += 1; }
  }
  a.played += 1; b.played += 1;
  const winner = sets1 === 3 ? a : b;
  const loser = sets1 === 3 ? b : a;
  const loserSets = sets1 === 3 ? sets2 : sets1;
  winner.wins += 1; loser.losses += 1;
  winner.points += loserSets <= 1 ? scoring.straightSetsWinner : scoring.fiveSetsWinner;
  if (loserSets === 2) loser.points += scoring.fiveSetsLoser;
}

// 只统计这些队伍相互之间的比赛,用于"相互间成绩"比较。
function mutualStats(teamIds, results, scoring) {
  const involved = new Set(teamIds);
  const stats = new Map(teamIds.map((t) => [t, { mp: 0, mw: 0, ml: 0, sw: 0, sl: 0, pw: 0, pl: 0 }]));
  for (const r of results) {
    if (!involved.has(r.teams[0]) || !involved.has(r.teams[1])) continue;
    const a = stats.get(r.teams[0]);
    const b = stats.get(r.teams[1]);
    let sets1 = 0;
    let sets2 = 0;
    for (const [x, y] of r.sets) {
      a.pw += x; a.pl += y; b.pw += y; b.pl += x;
      if (x > y) { sets1 += 1; a.sw += 1; b.sl += 1; } else { sets2 += 1; b.sw += 1; a.sl += 1; }
    }
    const winner = sets1 === 3 ? a : b;
    const loser = sets1 === 3 ? b : a;
    const loserSets = sets1 === 3 ? sets2 : sets1;
    winner.mw += 1; loser.ml += 1;
    winner.mp += loserSets <= 1 ? scoring.straightSetsWinner : scoring.fiveSetsWinner;
    if (loserSets === 2) loser.mp += scoring.fiveSetsLoser;
  }
  return stats;
}

const h2hKey = (m) => [m.mp, { w: m.sw, l: m.sl }, { w: m.pw, l: m.pl }];
const h2hText = (m) => `${m.mw}胜${m.ml}负`;

function keyOf(row, c, results, scoring) {
  if (c === 'headToHead') return null; // 相互间成绩按同分组整体计算,见 rankRecursive
  return criterionValue(row, c);
}

// 递归排名:按比较链逐级把同分队细分;链尽仍并列则按队伍编号落位并记为"抽签"。
function rankRecursive(rows, chain, results, scoring) {
  if (rows.length < 2) return rows;
  if (chain.length === 0) {
    return [...rows].sort((a, b) => (a.team < b.team ? -1 : 1));
  }
  const [c, ...rest] = chain;
  let keyFn;
  if (c === 'headToHead') {
    const mutual = mutualStats(rows.map((r) => r.team), results, scoring);
    keyFn = (r) => h2hKey(mutual.get(r.team));
  } else {
    keyFn = (r) => keyOf(r, c, results, scoring);
  }
  const decorated = rows.map((r) => ({ r, key: keyFn(r) }));
  decorated.sort((x, y) => compareValues(y.key, x.key));
  const out = [];
  let i = 0;
  while (i < decorated.length) {
    let j = i;
    while (j + 1 < decorated.length && compareValues(decorated[j + 1].key, decorated[i].key) === 0) j += 1;
    out.push(...rankRecursive(decorated.slice(i, j + 1).map((d) => d.r), rest, results, scoring));
    i = j + 1;
  }
  return out;
}

// 相邻两名之间,找出规则链上第一级能分出先后的准则,供解释使用。
function decisionBetween(a, b, chain, results, scoring) {
  for (const c of chain) {
    if (c === 'headToHead') {
      const mutual = mutualStats([a.team, b.team], results, scoring);
      const ka = h2hKey(mutual.get(a.team));
      const kb = h2hKey(mutual.get(b.team));
      if (compareValues(ka, kb) !== 0) {
        return {
          between: [a.team, b.team], criterion: c, label: CRITERIA[c].label,
          aText: h2hText(mutual.get(a.team)), bText: h2hText(mutual.get(b.team)),
        };
      }
    } else {
      const va = criterionValue(a, c);
      const vb = criterionValue(b, c);
      if (compareValues(va, vb) !== 0) {
        return {
          between: [a.team, b.team], criterion: c, label: CRITERIA[c].label,
          aText: CRITERIA[c].text(a), bText: CRITERIA[c].text(b),
        };
      }
    }
  }
  return { between: [a.team, b.team], criterion: 'lot', label: CRITERIA.lot.label, aText: a.team, bText: b.team };
}

// 对一组队伍排名,返回名次与相邻名次的判定依据。
export function rankRows(rows, chain, results, scoring) {
  const ordered = rankRecursive(rows, chain, results, scoring);
  const decisions = [];
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    decisions.push(decisionBetween(ordered[i], ordered[i + 1], chain, results, scoring));
  }
  return { rows: ordered, decisions };
}

// 计算全部小组的积分表与顺位。
export function computeStandings(fixture, results, penalties, rules) {
  return Object.entries(fixture.groups).map(([group, teamIds]) => {
    const rows = new Map(teamIds.map((t) => [t, blankRow(t)]));
    for (const r of results) {
      if (rows.has(r.teams[0]) && rows.has(r.teams[1])) applyResult(rows, r, rules.scoring);
    }
    for (const p of penalties) {
      const row = rows.get(p.penalty.team);
      if (row) {
        row.points += p.penalty.points;
        row.penaltyPoints += p.penalty.points;
        row.penalties.push({ record_id: p.record_id, points: p.penalty.points, reason: p.reason });
      }
    }
    const ranked = rankRows([...rows.values()], rules.group_tiebreakers, results, rules.scoring);
    ranked.rows.forEach((row, i) => { row.rank = i + 1; });
    return { group, rows: ranked.rows, decisions: ranked.decisions };
  });
}
