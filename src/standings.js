// 组内排名。
//
// 每支球队的统计完全由“当前生效赛果”重算（更正已体现在 effectiveMatch）：
//   played 胜场 积分 胜局/负局（C 值） 得分/失分（Z 值）
// 处罚扣分作用于积分这一项；弃权赛果按 0:3（0:25×3）天然计入局分与得分。
//
// 平分处理按 FIVB 一般办法：
//   积分 → 胜场 → C 值 → Z 值
//   两队仍平：相互间胜负
//   三队及以上仍平：仅在平分集团内部重算积分/C 值/Z 值（小循环）
//   仍不能区分：抽签（抽签结果须在记录中由技术代表确认）

import { RULES } from './rules.js';
import { activePenaltyPoints, drawOrder, effectiveMatch } from './records.js';

const ratio = (w, l) => (l === 0 ? Infinity : w / l);

// 从一组比赛中为单队累计统计。excludeOpponents 给出要剔除的对手
// （跨组比较第三名时，5 队组剔除与本组垫底队的对赛）。
export function teamStats(state, teamId, matches, excludeOpponents = null) {
  const row = {
    team: teamId,
    played: 0,
    wins: 0,
    points: 0,
    matchPoints: 0,
    penaltyPoints: activePenaltyPoints(state, teamId).total,
    sw: 0,
    sl: 0,
    spw: 0,
    spl: 0,
  };

  for (const m of matches) {
    if (m.home !== teamId && m.away !== teamId) continue;
    const opp = m.home === teamId ? m.away : m.home;
    if (excludeOpponents && excludeOpponents.has(opp)) continue;

    row.played += 1;
    const side = m.home === teamId ? 'home' : 'away';
    const myWins = side === 'home' ? m.homeWins : m.awayWins;
    const opWins = side === 'home' ? m.awayWins : m.homeWins;
    const myPts = side === 'home' ? m.homePoints : m.awayPoints;
    const opPts = side === 'home' ? m.awayPoints : m.homePoints;

    if (myWins === 3) {
      row.wins += 1;
      row.points += opWins === 2 ? RULES.points.win32 : RULES.points.win30or31;
    } else {
      row.points += myWins === 2 ? RULES.points.lose32 : RULES.points.lose30or31;
    }
    row.sw += myWins;
    row.sl += opWins;
    row.spw += myPts;
    row.spl += opPts;
  }

  row.matchPoints = row.points;
  row.points -= row.penaltyPoints;
  row.setRatio = ratio(row.sw, row.sl);
  row.pointRatio = ratio(row.spw, row.spl);
  return row;
}

function stableSort(rows, keyFn) {
  return [...rows].sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    if (kb > ka) return 1;
    if (kb < ka) return -1;
    return 0;
  });
}

function equalPartitions(sorted, keyFn) {
  const parts = [];
  for (const row of sorted) {
    const last = parts[parts.length - 1];
    if (last && keyFn(last[0]) === keyFn(row)) last.push(row);
    else parts.push([row]);
  }
  return parts;
}

// 通用排名：输入候选行（已含统计字段），输出带 rank/decidedBy 的顺序。
// ctx: { state, stage, matchesByTeam?, headToHead?: bool }
// stage 用于抽签键（group / third / seed）。
export function rankCandidates(candidates, ctx) {
  const pendingDraws = [];
  const out = [];
  const keys = [
    ['points', (r) => r.points],
    ['wins', (r) => r.wins],
    ['setRatio', (r) => ratio(r.sw, r.sl)],
    ['pointRatio', (r) => ratio(r.spw, r.spl)],
  ];

  const drawSort = (group, restricted) => {
    const teams = group.map((g) => g.team).sort();
    const order = drawOrder(ctx.state, ctx.stage, teams);
    if (!order) {
      pendingDraws.push({ stage: ctx.stage, tieKey: `${ctx.stage}:${teams.join('=')}`, teams, restricted });
      return group.map((g) => ({ ...g, decidedBy: 'pendingDraw', restricted: restricted || null }));
    }
    const byTeam = new Map(group.map((g) => [g.team, g]));
    return order.map((t) => ({ ...byTeam.get(t), decidedBy: 'draw', restricted: restricted || null }));
  };

  const finalTie = (group, restricted = false) => {
    if (group.length === 2 && ctx.headToHead && ctx.headToHeadWinner) {
      const [a, b] = group;
      const winner = ctx.headToHeadWinner(a.team, b.team);
      if (winner && (winner === a.team || winner === b.team)) {
        const loser = winner === a.team ? b : a;
        const win = winner === a.team ? a : b;
        out.push({ ...win, decidedBy: 'headToHead', restricted: restricted || null });
        out.push({ ...loser, decidedBy: 'headToHead', restricted: restricted || null });
        return;
      }
    }
    if (group.length > 2 && ctx.restrictedStats) {
      // 平分集团内部小循环：仅计彼此对赛，再走一遍相同指标
      const rs = ctx.restrictedStats(group.map((g) => g.team));
      const byTeam = new Map(group.map((g) => [g.team, g]));
      let remaining = rs;
      let splitHere = null;
      for (const [name, keyFn] of keys) {
        const sorted = stableSort(remaining, keyFn);
        const parts = equalPartitions(sorted, keyFn);
        if (parts.length > 1) {
          splitHere = { name, parts };
          break;
        }
      }
      if (splitHere) {
        for (const part of splitHere.parts) {
          const rows = part.map((r) => byTeam.get(r.team));
          if (rows.length === 1) {
            out.push({ ...rows[0], decidedBy: splitHere.name, restricted: true });
          } else {
            // 小循环后仍有 2 队平分：相互间可判；否则抽签
            finalTie(rows, true);
          }
        }
        return;
      }
    }
    out.push(...drawSort(group, restricted));
  };

  const walk = (group, level) => {
    if (group.length === 1) {
      out.push({ ...group[0], decidedBy: level === 0 ? 'sole' : keys[level - 1][0] });
      return;
    }
    if (level >= keys.length) {
      finalTie(group);
      return;
    }
    const [name, keyFn] = keys[level];
    const sorted = stableSort(group, keyFn);
    for (const part of equalPartitions(sorted, keyFn)) {
      if (part.length === 1) out.push({ ...part[0], decidedBy: name });
      else walk(part, level + 1);
    }
  };

  walk(candidates, 0);
  out.forEach((r, i) => {
    r.rank = i + 1;
  });
  return { order: out, pendingDraws };
}

// 组内比赛列表（当前生效）
export function groupMatches(state, groupMatchIds) {
  return groupMatchIds.map((id) => effectiveMatch(state, id)).filter(Boolean);
}

// 相互间胜者（单循环只对赛一次）
export function makeHeadToHeadWinner(matches) {
  const key = (a, b) => [a, b].sort().join('@');
  const table = new Map();
  for (const m of matches) {
    table.set(key(m.home, m.away), m.winner);
  }
  return (a, b) => table.get(key(a, b)) ?? null;
}
