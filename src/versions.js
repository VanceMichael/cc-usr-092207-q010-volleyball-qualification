// 版本发布与锁定。
// 每次发布产生一个不可变的版本快照:发布时间、所用规则编号、纳入的记录编号、
// 积分表、晋级名单、签位与对阵。补录、处罚扣分、申诉改判发布后生成新版本;
// 已经开赛的淘汰赛签位必须锁定,未开赛的可以按新结果重排,锁定与新结果
// 不一致时记入 conflicts,交竞赛委员会裁定。
import { effectiveRecords } from './records.js';
import { computeStandings } from './standings.js';
import { computeAdvancement } from './advancement.js';

export function computeTournament(fixture, ledger, rules) {
  const { results, penalties } = effectiveRecords(ledger);
  const standings = computeStandings(fixture, results, penalties, rules);
  const advancement = computeAdvancement(standings, rules, results);
  return { standings, advancement };
}

// knockoutStates: 各淘汰赛签位当前状态,如 { QF1: 'started' }。
// scheduled(未开赛)的对阵可以重排;started/finished 的必须锁定。
export function publishVersion({ fixture, ledger, rules, knockoutStates = {}, previous = null, published_at }) {
  if (!published_at) throw new Error('发布版本须注明发布时间');
  const { standings, advancement } = computeTournament(fixture, ledger, rules);
  const bracket = advancement.bracket.map((slot) => ({ ...slot, locked: false, source: 'computed' }));
  const conflicts = [];
  const rearranged = [];

  if (previous) {
    for (const slot of bracket) {
      const prevSlot = previous.bracket.find((s) => s.slot === slot.slot);
      if (!prevSlot) continue;
      const changed = prevSlot.home !== slot.home || prevSlot.away !== slot.away;
      const state = knockoutStates[slot.slot] || 'scheduled';
      if (state === 'started' || state === 'finished') {
        slot.locked = true;
        if (changed) {
          // 已开赛,签位锁定:保留原参赛队,冲突留待竞赛委员会裁定
          conflicts.push({
            slot: slot.slot,
            kept: { home: prevSlot.home, away: prevSlot.away },
            computed: { home: slot.home, away: slot.away },
            reason: '比赛已开赛,签位锁定;新结果与锁定对阵不一致,需竞赛委员会裁定',
          });
          slot.home = prevSlot.home;
          slot.away = prevSlot.away;
          slot.source = 'locked';
        }
      } else if (changed) {
        rearranged.push(slot.slot);
      }
    }
  }

  return {
    version: previous ? previous.version + 1 : 1,
    published_at,
    rules_id: rules.id,
    record_ids: ledger.records.filter((r) => r.status === 'confirmed').map((r) => r.record_id),
    teamNames: Object.fromEntries((fixture.teams || []).map((t) => [t.id, t.name])),
    standings,
    advancement,
    bracket,
    conflicts,
    rearranged,
  };
}

// 两个版本之间的差异:谁晋级、谁出局、谁的签位变了,由哪些新记录引起。
export function diffVersions(prev, next) {
  const seedOf = (v) => new Map(v.advancement.seeds.map((s) => [s.team, s.seed]));
  const p = seedOf(prev);
  const n = seedOf(next);
  const changes = [];
  for (const [team, seed] of n) {
    if (!p.has(team)) changes.push({ team, type: 'advanced', seed });
  }
  for (const [team, seed] of p) {
    if (!n.has(team)) changes.push({ team, type: 'eliminated', wasSeed: seed });
  }
  for (const [team, seed] of n) {
    if (p.has(team) && p.get(team) !== seed) {
      changes.push({ team, type: 'seed-changed', from: p.get(team), to: seed });
    }
  }
  const newRecords = next.record_ids.filter((id) => !prev.record_ids.includes(id));
  return { changes, newRecords, conflicts: next.conflicts, rearranged: next.rearranged };
}

// 公众榜单:只含名次、对阵与发布时间。
export function publicView(version) {
  return {
    version: version.version,
    published_at: version.published_at,
    seeds: version.advancement.seeds.map((s) => ({ seed: s.seed, team: s.team })),
    bracket: version.bracket.map((s) => ({
      slot: s.slot, home: s.home, away: s.away, locked: s.locked,
    })),
  };
}
