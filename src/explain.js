// 解释与核对。
//
// 面对任意已发布版本（快照），回答三类问题：
//   1. 某队为什么晋级 / 为什么排这个签位（explainTeam）；
//   2. 两个版本之间，规则计算结果改了谁（diffSnapshots）；
//   3. 球队核对自己的原始记录：原始登记、历次更正、处罚与撤销、开赛事件
//      全部原样列出，注明哪一条当前生效（teamRecordBook）。

const CRITERION_NAME = {
  points: '积分',
  wins: '胜场',
  setRatio: 'C 值（局分比）',
  pointRatio: 'Z 值（得分比）',
  headToHead: '相互间胜负',
  draw: '抽签',
  pendingDraw: '抽签（尚未确认）',
  sole: '唯一（无平分）',
};

export function criterionName(k) {
  return CRITERION_NAME[k] ?? k;
}

function fmtRatio(v) {
  if (v === Infinity) return '∞';
  return Number.isFinite(v) ? v.toFixed(3) : String(v);
}

function statLine(row) {
  return {
    积分: row.points,
    原始积分: row.matchPoints,
    处罚扣分: row.penaltyPoints,
    胜场: `${row.wins}/${row.played}`,
    C值: `${row.sw}:${row.sl}=${fmtRatio(row.setRatio)}`,
    Z值: `${row.spw}:${row.spl}=${fmtRatio(row.pointRatio)}`,
  };
}

// 解释一支球队在某个发布版本中的处境。
export function explainTeam(snapshot, teamId) {
  const out = { team: teamId, version: snapshot.version, publishedAt: snapshot.publishedAt };

  for (const g of snapshot.groups) {
    const idx = g.order.findIndex((r) => r.team === teamId);
    if (idx >= 0) {
      const row = g.order[idx];
      out.group = {
        groupId: g.groupId,
        rank: row.rank,
        decidedBy: criterionName(row.decidedBy),
        restrictedCycle: row.restricted,
        stats: statLine(row),
      };
      if (idx < g.order.length - 1) {
        const next = g.order[idx + 1];
        out.group.vsNext = {
          team: next.team,
          separatedAt: criterionName(row.decidedBy),
          theirStats: statLine(next),
        };
      }
      if (idx > 0) {
        const prev = g.order[idx - 1];
        out.group.vsPrev = { team: prev.team, theirStats: statLine(prev) };
      }
      break;
    }
  }

  const third = snapshot.thirdPlace.find((t) => t.team === teamId);
  if (third) {
    out.thirdPlace = {
      rankAmongThirds: third.rankAmongThirds,
      normalized: '5 队组已剔除与本组垫底队的对赛成绩' ,
      stats: statLine(third.stats),
      qualified: third.qualified,
      decidedBy: criterionName(third.decidedBy),
    };
  }

  const seed = snapshot.seeds.find((s) => s.team === teamId);
  if (seed) {
    out.seed = {
      seed: seed.seed,
      group: seed.group,
      placement: seed.placement,
      decidedBy: criterionName(seed.decidedBy),
      stats: statLine(seed),
    };
    const qf = snapshot.quarterfinals.find((q) => qfHas(q, teamId));
    if (qf) {
      out.quarterfinal = {
        matchId: qf.matchId,
        opponent: qf.home === teamId ? qf.away : qf.home,
        side: qf.home === teamId ? 'home' : 'away',
        homeSeed: qf.homeSeed,
        awaySeed: qf.awaySeed,
        locked: qf.locked,
        lockedSince: qf.lockedSince ?? null,
        conflict: qf.conflict ?? null,
      };
    }
  } else {
    out.eliminated = true;
  }

  out.qualificationReason = seed
    ? seed.placement <= 2
      ? `小组第 ${seed.placement} 名直接晋级，按归一化战绩排在 ${seed.seed} 号签`
      : `小组第三，跨组比较第 ${third?.rankAmongThirds ?? '?'} 名晋级，按归一化战绩排在 ${seed.seed} 号签`
    : third
      ? `小组第三，跨组比较列第 ${third.rankAmongThirds} 名，仅取前两名，未晋级`
      : '未进入晋级区';

  return out;
}

function qfHas(qf, teamId) {
  return qf.home === teamId || qf.away === teamId;
}

// 两个已发布版本的差异。
export function diffSnapshots(oldSnap, newSnap) {
  const d = {
    from: { version: oldSnap.version, publishedAt: oldSnap.publishedAt },
    to: { version: newSnap.version, publishedAt: newSnap.publishedAt },
    groups: [],
    thirdPlace: [],
    seeds: [],
    quarterfinals: [],
    newConflicts: [],
    resolvedConflicts: [],
  };

  for (const ng of newSnap.groups) {
    const og = oldSnap.groups.find((g) => g.groupId === ng.groupId);
    const changes = [];
    for (const nr of ng.order) {
      const or = og?.order.find((r) => r.team === nr.team);
      if (!or || or.rank !== nr.rank || or.points !== nr.points || or.decidedBy !== nr.decidedBy) {
        changes.push({
          team: nr.team,
          from: or ? { rank: or.rank, points: or.points, decidedBy: criterionName(or.decidedBy) } : null,
          to: { rank: nr.rank, points: nr.points, decidedBy: criterionName(nr.decidedBy) },
        });
      }
    }
    if (changes.length) d.groups.push({ groupId: ng.groupId, changes });
  }

  const oldThird = new Map(oldSnap.thirdPlace.map((t) => [t.team, t]));
  for (const t of newSnap.thirdPlace) {
    const o = oldThird.get(t.team);
    if (!o || o.rankAmongThirds !== t.rankAmongThirds || o.qualified !== t.qualified) {
      d.thirdPlace.push({
        team: t.team,
        from: o ? { rank: o.rankAmongThirds, qualified: o.qualified } : null,
        to: { rank: t.rankAmongThirds, qualified: t.qualified },
      });
    }
  }

  const oldSeed = new Map(oldSnap.seeds.map((s) => [s.team, s]));
  const newSeed = new Map(newSnap.seeds.map((s) => [s.team, s]));
  for (const [team, ns] of newSeed) {
    const os = oldSeed.get(team);
    if (!os || os.seed !== ns.seed) {
      d.seeds.push({ team, from: os?.seed ?? null, to: ns.seed });
    }
  }
  for (const [team, os] of oldSeed) {
    if (!newSeed.has(team)) d.seeds.push({ team, from: os.seed, to: null });
  }

  for (const nq of newSnap.quarterfinals) {
    const oq = oldSnap.quarterfinals.find((q) => q.matchId === nq.matchId);
    const sig = (q) => (q ? `${q.home}@${q.away}|locked=${q.locked}` : null);
    if (!oq || sig(oq) !== sig(nq)) {
      d.quarterfinals.push({
        matchId: nq.matchId,
        from: oq ? { home: oq.home, away: oq.away, locked: oq.locked } : null,
        to: { home: nq.home, away: nq.away, locked: nq.locked },
      });
    }
  }

  const keyOf = (c) => JSON.stringify(c);
  const oldConflicts = new Set(oldSnap.conflicts.map(keyOf));
  const newConflicts = new Set(newSnap.conflicts.map(keyOf));
  d.newConflicts = newSnap.conflicts.filter((c) => !oldConflicts.has(keyOf(c)));
  d.resolvedConflicts = oldSnap.conflicts.filter((c) => !newConflicts.has(keyOf(c)));
  d.hasChanges =
    d.groups.length > 0 ||
    d.thirdPlace.length > 0 ||
    d.seeds.length > 0 ||
    d.quarterfinals.length > 0 ||
    d.newConflicts.length > 0 ||
    d.resolvedConflicts.length > 0;
  return d;
}

// 球队原始记录簿：从原始事件流中抽取与该队有关的全部记录，保持原貌。
export function teamRecordBook(events, teamId) {
  const penaltyTeam = new Map(
    events.filter((e) => e.type === 'penalty').map((e) => [e.id, e.team])
  );
  const book = {
    team: teamId,
    matches: [],
    penalties: [],
    reversals: [],
    kicks: [],
  };
  for (const e of events) {
    if (e.type === 'matchResult' || e.type === 'correction') {
      if (e.home !== teamId && e.away !== teamId) continue;
      let slot = book.matches.find((m) => m.matchId === e.matchId);
      if (!slot) {
        slot = { matchId: e.matchId, stage: e.stage, home: e.home, away: e.away, versions: [] };
        book.matches.push(slot);
      }
      slot.versions.push({
        recordId: e.id,
        ts: e.ts,
        type: e.type,
        basis: e.basis ?? null,
        reason: e.reason ?? null,
        forfeit: e.forfeit ?? null,
        rosterChallenge: e.rosterChallenge ?? null,
        sets: e.sets,
        confirmedBy: e.confirmedBy,
      });
    } else if (e.type === 'penalty' && e.team === teamId) {
      book.penalties.push({ recordId: e.id, ts: e.ts, points: e.points, reason: e.reason });
    } else if (e.type === 'penaltyReversal' && penaltyTeam.get(e.penaltyId) === teamId) {
      book.reversals.push({ recordId: e.id, ts: e.ts, penaltyId: e.penaltyId, reason: e.reason });
    } else if (e.type === 'kickoff') {
      book.kicks.push({ recordId: e.id, ts: e.ts, matchId: e.matchId });
    }
  }
  // 标注每场比赛当前生效的版本
  for (const m of book.matches) {
    m.currentRecordId = m.versions.at(-1).recordId;
  }
  return book;
}
