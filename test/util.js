import { readFile } from 'node:fs/promises';

export const readJson = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));

let seq = 0;
const nextId = (p) => `${p}-${(++seq).toString(36)}`;

// 构造一条合法小组赛果事件。sets 形如 [[25, 20], ...]（主队在前）。
export function matchEvent({
  id,
  ts = '2025-09-10T10:00:00+08:00',
  matchId,
  home,
  away,
  sets,
  group = 'X',
  forfeit,
  rosterChallenge,
  basis,
  reason,
  type = 'matchResult',
}) {
  return {
    id: id ?? `R-${matchId ?? nextId('m')}`,
    type,
    ts,
    matchId,
    stage: 'group',
    group,
    home,
    away,
    sets: sets.map(([h, a]) => ({ home: h, away: a })),
    ...(forfeit ? { forfeit } : {}),
    ...(rosterChallenge ? { rosterChallenge } : {}),
    ...(basis ? { basis } : {}),
    ...(reason ? { reason } : {}),
    confirmedBy: { referee: 'R-T' },
  };
}

export const win30 = (n = 0) => [
  [25, 18 + n],
  [25, 19 + ((n + 1) % 5)],
  [25, 20 + ((n + 2) % 4)],
];

export function miniTournament(groups) {
  return {
    domain: 'volleyball-qualification',
    edition: { code: 'test', name: '测试赛' },
    teams: groups.flatMap((g) => g.teamIds.map((id) => ({ id, name: id, group: g.id }))),
    groups,
    knockout: { quarterfinalIds: ['QF1', 'QF2', 'QF3', 'QF4'] },
  };
}
