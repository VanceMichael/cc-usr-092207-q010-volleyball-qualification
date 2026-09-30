// 发布版本与开赛锁定。
//
// 发布（publication）是对“截至某一时刻全部不可覆盖记录”的带时间快照：
//   - 快照内容由记录重算，不能手工改数字；
//   - 已发布的快照一经生成即冻结，公众榜单始终引用某个版本号与发布时间；
//   - 补录、处罚、申诉改判之后发布新版本，旧版本仍可完整重放。
//
// 锁定规则（当届办法）：四分之一决赛一经开赛，该场对阵与其所占签号槽位
// 一起锁定。修正后重算：
//   - 已开赛场次保留原双方。重算签位持有者若与之不同，记 lockedQuarterfinal
//     冲突（本该在该签位的队同时记 qualifierDisplacedByLock）；
//   - 未开赛场次按新签位持有者入位；若某槽位的新持有者已被锁进另一场，
//     记 teamDoubleBooked 冲突；
//   - 被锁定球队按新战绩已不在八强，记 lockedTeamNoLongerQualifies。
// 系统只标记冲突，不自动改写已开赛对阵，处置权在竞委会/仲裁。

import { evaluate } from './qualification.js';
import { replay } from './records.js';
import { RULES } from './rules.js';

export class PublicationError extends Error {}

const SLOT_DEF = Object.fromEntries(RULES.knockout.quarterfinals.map((q) => [q.matchId, q]));

function eventsUntil(events, cutoff) {
  const t = Date.parse(cutoff);
  return events.filter((e) => Date.parse(e.ts) <= t);
}

// 单纯生成某个时刻的重算结果（不含锁），供历史重放与对比使用。
export function snapshotAt(tournament, events, { cutoffTs }) {
  const state = replay(eventsUntil(events, cutoffTs), {
    teamsById: new Set(tournament.teams.map((t) => t.id)),
  });
  return { cutoffTs, state, evaluation: evaluate(tournament, state) };
}

// 发布新版本。
//   spec: { version, publishedAt, note, cutoffTs? }
//   prior: 已发布快照数组（按版本顺序）
export function publish(tournament, events, spec, prior = []) {
  if (!spec?.version || !spec?.publishedAt || !spec.note) {
    throw new PublicationError('发布必须包含 version、publishedAt、note');
  }
  if (prior.some((s) => s.version === spec.version)) {
    throw new PublicationError(`版本 ${spec.version} 已发布，不能覆盖`);
  }
  const cutoffTs = spec.cutoffTs ?? spec.publishedAt;
  const { state, evaluation } = snapshotAt(tournament, events, { cutoffTs });

  // 已开赛的 QF：以开赛前最近一次发布的对阵为锁定双方。
  const lockedByMatch = new Map();
  for (const kick of state.kicks.values()) {
    if (Date.parse(kick.ts) > Date.parse(cutoffTs)) continue;
    let fixture = null;
    for (let i = prior.length - 1; i >= 0; i--) {
      const qf = prior[i].quarterfinals.find((q) => q.matchId === kick.matchId);
      if (qf && qf.home && qf.away) {
        fixture = qf;
        break;
      }
    }
    if (!fixture) {
      throw new PublicationError(
        `${kick.matchId} 已开赛（${kick.ts}），但没有开赛前发布的对阵可供锁定`
      );
    }
    lockedByMatch.set(kick.matchId, { matchId: kick.matchId, since: kick.ts, home: fixture.home, away: fixture.away });
  }

  const holderOfSeed = (seedNo) => evaluation.seeds.find((s) => s.seed === seedNo)?.team ?? null;
  const lockedTeams = new Set();
  for (const l of lockedByMatch.values()) {
    lockedTeams.add(l.home);
    lockedTeams.add(l.away);
  }
  const recomputedSet = new Set(evaluation.seeds.map((s) => s.team));
  const conflicts = [];

  const quarterfinals = RULES.knockout.quarterfinals.map((slot) => {
    const desired = evaluation.quarterfinals.find((q) => q.matchId === slot.matchId);
    const lock = lockedByMatch.get(slot.matchId);

    if (lock) {
      const desiredPair = new Set([desired.home, desired.away]);
      const changed = desiredPair.size === 2 && (!desiredPair.has(lock.home) || !desiredPair.has(lock.away));
      if (changed) {
        conflicts.push({
          type: 'lockedQuarterfinal',
          matchId: slot.matchId,
          lockedHome: lock.home,
          lockedAway: lock.away,
          desiredHome: desired.home,
          desiredAway: desired.away,
          detail: '该场已开赛，对阵锁定；按最新赛果重算的签位持有者与之不同，须仲裁处置',
        });
      }
      return {
        matchId: slot.matchId,
        homeSeed: slot.homeSeed,
        awaySeed: slot.awaySeed,
        home: lock.home,
        away: lock.away,
        locked: true,
        lockedSince: lock.since,
        desiredHome: desired.home,
        desiredAway: desired.away,
        conflict: changed ? 'lockedFixtureDiffersFromRecomputed' : null,
        kickedOff: true,
        kickoffTs: lock.since,
        hasResult: desired.hasResult,
      };
    }

    // 未开赛：按重算签位持有者入位
    const home = holderOfSeed(slot.homeSeed);
    const away = holderOfSeed(slot.awaySeed);
    const homeBooked = home && lockedTeams.has(home);
    const awayBooked = away && lockedTeams.has(away);
    if (homeBooked || awayBooked) {
      conflicts.push({
        type: 'teamDoubleBooked',
        matchId: slot.matchId,
        home,
        away,
        homeSeed: slot.homeSeed,
        awaySeed: slot.awaySeed,
        detail: '该场未开赛可重排，但其重算签位持有者已被开赛锁定在另一场，须仲裁处置',
      });
    }
    return {
      matchId: slot.matchId,
      homeSeed: slot.homeSeed,
      awaySeed: slot.awaySeed,
      home,
      away,
      locked: false,
      conflict: homeBooked || awayBooked ? 'holderLockedElsewhere' : null,
      kickedOff: false,
      kickoffTs: null,
      hasResult: desired.hasResult,
    };
  });

  // 被锁定球队按新战绩已不该晋级
  for (const t of lockedTeams) {
    if (!recomputedSet.has(t)) {
      conflicts.push({
        type: 'lockedTeamNoLongerQualifies',
        team: t,
        detail: '该队所在四分之一决赛已开赛而锁定，但按最新赛果其已不在八强',
      });
    }
  }
  // 按新战绩应占“已锁定签位”的队：无处可排，被锁占席
  const placedTeams = new Set(lockedTeams);
  for (const qf of quarterfinals) {
    if (!qf.locked) {
      if (qf.home && !lockedTeams.has(qf.home)) placedTeams.add(qf.home);
      if (qf.away && !lockedTeams.has(qf.away)) placedTeams.add(qf.away);
    }
  }
  for (const t of recomputedSet) {
    if (!placedTeams.has(t)) {
      conflicts.push({
        type: 'qualifierDisplacedByLock',
        team: t,
        detail: '按最新赛果该队应晋级并占据某签位，但该签位所属场次已开赛锁定，须仲裁处置',
      });
    }
  }

  const recordIds = state.timeline.map((e) => e.id);
  const snapshot = {
    version: spec.version,
    publishedAt: spec.publishedAt,
    cutoffTs,
    note: spec.note,
    edition: evaluation.rules,
    basedOn: { recordIds, recordCount: recordIds.length },
    groups: evaluation.groups.map((g) => ({
      groupId: g.group.id,
      order: g.order.map((r) => ({
        rank: r.rank,
        team: r.team,
        played: r.played,
        wins: r.wins,
        matchPoints: r.matchPoints,
        penaltyPoints: r.penaltyPoints,
        points: r.points,
        sw: r.sw,
        sl: r.sl,
        setRatio: r.setRatio,
        spw: r.spw,
        spl: r.spl,
        pointRatio: r.pointRatio,
        decidedBy: r.decidedBy,
        restricted: r.restricted ?? false,
      })),
      last: g.last,
    })),
    thirdPlace: evaluation.thirdPlace,
    qualifiers: evaluation.qualifiers,
    eliminatedThirds: evaluation.eliminatedThirds,
    seeds: evaluation.seeds,
    pendingDraws: evaluation.pendingDraws,
    quarterfinals,
    locks: [...lockedByMatch.values()],
    conflicts,
  };
  if (snapshot.pendingDraws.length > 0) {
    snapshot.notice = '存在尚未经抽签确认的平分，相关顺位/签位为待定';
  }
  return snapshot;
}
