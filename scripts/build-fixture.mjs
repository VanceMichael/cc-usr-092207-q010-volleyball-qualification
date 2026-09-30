// 示例赛事数据生成器：紧凑赛果表 → 不可覆盖事件 → v1/v2 发布快照。
// 运行：node scripts/build-fixture.mjs
// 球队/裁判均为虚构代号，不含任何真实个人信息。
//
// 剧本：
//   09-20 蓝湾与静海归一化战绩完全相同，技术代表抽签：蓝湾 1 号、静海 2 号
//   09-21 v1 发布小组赛成绩与八强对阵（江洲有 2 分处罚；沙溪-鹤城误记 3:1）
//         两个第三名（归一化口径）：云港（4 分）与梅浦（4 分，Z 值区分），
//         鹤城 3 分出局；蓝湾与静海 9 分、9:1 局、247:204 分完全相同，抽签定 1/2 号
//   09-23 QF4（2 号签静海 vs 7 号签云港）开赛 → 对阵锁定
//   09-24 记分台复核改判 3:1→3:2；江洲申诉成立撤销扣分
//         鹤城取得 4 分且 C 值 0.857 压过云港/梅浦的 0.833，升至 7 号签，
//         梅浦掉出八强，云港降 8 号
//   09-24 v2 发布：QF1-QF3 重排，QF4 锁定（重算应为静海-鹤城），
//         QF1 中云港双重占场、鹤城被锁定占席，全部列入仲裁冲突

import { writeFile, mkdir } from 'node:fs/promises';
import { publish } from '../src/publication.js';
import { RULES } from '../src/rules.js';

const T = {
  A: {
    LW: '蓝湾',
    QC: '青川',
    YG: '云港',
    ST: '石台',
    FL: '枫岭',
  },
  B: {
    SX: '沙溪',
    HC: '鹤城',
    YM: '雁门',
    JZ: '江洲',
    YC: '越城',
  },
  C: {
    JH: '静海',
    MP: '梅浦',
    SY: '松阳',
    TC: '桐川',
  },
};

// 主队列前；r 为主队视角；sets 可显式指定（[主,客]）
const M = (id, group, date, home, away, r, extra = {}) => ({ id, group, date, home, away, r, ...extra });

const matches = [
  // ---------- A 组 ----------
  M('GA01', 'A', '2025-09-12', 'LW', 'QC', '3-1', { sets: [[25, 20], [22, 25], [25, 21], [25, 22]] }),
  M('GA02', 'A', '2025-09-13', 'LW', 'YG', '3-0', { sets: [[25, 19], [25, 17], [25, 21]] }),
  M('GA03', 'A', '2025-09-14', 'LW', 'ST', '3-0', { sets: [[25, 18], [25, 22], [25, 19]] }),
  M('GA04', 'A', '2025-09-15', 'LW', 'FL', '3-0'),
  M('GA05', 'A', '2025-09-16', 'QC', 'YG', '3-2'),
  M('GA06', 'A', '2025-09-17', 'QC', 'ST', '3-1'),
  M('GA07', 'A', '2025-09-17', 'QC', 'FL', '3-0'),
  // 云港对石台阵容异议成立：石台违规，记 0:3 弃权
  M('GA08', 'A', '2025-09-18', 'YG', 'ST', '3-0', {
    forfeit: 'away',
    rosterChallenge: {
      raised: 'home',
      disposition: 'upheld',
      note: '客队场上阵容与报名位置表不符，裁判长与技术代表合议后异议成立',
    },
    notes: '按规程判石台队 0:3 告负',
  }),
  // 枫岭赛前因多名队员伤病弃权
  M('GA09', 'A', '2025-09-19', 'ST', 'FL', '3-0', { forfeit: 'away', notes: '枫岭队赛前因队员伤病弃权' }),
  M('GA10', 'A', '2025-09-20', 'YG', 'FL', '3-1'),

  // ---------- B 组 ----------
  // 原记分台误记主队 3:1，09-24 复核改判 3:2（见 correction 事件）
  M('GB01', 'B', '2025-09-12', 'SX', 'HC', '3-1', {
    sets: [[25, 22], [25, 23], [22, 25], [25, 20]],
    correctedSets: [[23, 25], [25, 21], [25, 19], [19, 25], [15, 12]],
  }),
  M('GB02', 'B', '2025-09-13', 'SX', 'YM', '3-0'),
  M('GB03', 'B', '2025-09-14', 'SX', 'JZ', '3-1'),
  M('GB04', 'B', '2025-09-15', 'SX', 'YC', '3-0'),
  M('GB05', 'B', '2025-09-16', 'JZ', 'HC', '3-1', { sets: [[25, 20], [22, 25], [25, 21], [25, 23]] }),
  M('GB06', 'B', '2025-09-17', 'JZ', 'YM', '3-0'),
  M('GB07', 'B', '2025-09-18', 'JZ', 'YC', '3-0'),
  M('GB08', 'B', '2025-09-18', 'HC', 'YM', '3-1', { sets: [[25, 21], [22, 25], [25, 20], [25, 18]] }),
  M('GB09', 'B', '2025-09-19', 'HC', 'YC', '3-0'),
  M('GB10', 'B', '2025-09-20', 'YM', 'YC', '3-0'),

  // ---------- C 组 ----------
  M('GC01', 'C', '2025-09-13', 'JH', 'MP', '3-0', { sets: [[25, 19], [25, 17], [25, 21]] }),
  M('GC02', 'C', '2025-09-14', 'JH', 'SY', '3-1', { sets: [[25, 20], [22, 25], [25, 21], [25, 22]] }),
  M('GC03', 'C', '2025-09-15', 'JH', 'TC', '3-0', { sets: [[25, 18], [25, 22], [25, 19]] }),
  M('GC04', 'C', '2025-09-16', 'SY', 'MP', '3-2', { sets: [[25, 23], [18, 25], [25, 22], [21, 25], [15, 12]] }),
  M('GC05', 'C', '2025-09-17', 'MP', 'TC', '3-0'),
  M('GC06', 'C', '2025-09-18', 'SY', 'TC', '3-1', { sets: [[25, 18], [25, 20], [23, 25], [25, 19]] }),
];

const refereeOf = (g) => ({
  A: 'R-118',
  B: 'R-205',
  C: 'R-309',
}[g]);

// 未显式给比分的比赛，按结果生成合法且确定的比分：
// 3:0 全胜；3:1 赢 1/2/4 局、输第 3 局；3:2 赢 1/2/5 局、输 3/4 局。
const genSets = (m) => {
  if (m.forfeit) return null;
  const homeWins = parseInt(m.r[0], 10) === 3;
  const games = parseInt(m.r[0], 10) + parseInt(m.r[2], 10);
  const loserWinsGame = games === 3 ? [] : games === 4 ? [2] : [2, 3]; // 0-based 输局位置
  return Array.from({ length: games }, (_, i) => {
    const deciding = i === 4;
    const win = deciding ? 15 : 25;
    const lose = deciding ? 12 : 18 + ((i * 7) % 6); // 18..23 轮换
    const homeTakes = homeWins ? !loserWinsGame.includes(i) : loserWinsGame.includes(i);
    return homeTakes ? [win, lose] : [lose, win];
  });
};

const toSets = (m, which) => {
  if (m.forfeit) {
    const loser = m.forfeit === 'home' ? [0, 25] : [25, 0];
    return [1, 2, 3].map(() => ({ home: loser[0], away: loser[1] }));
  }
  const rows = which === 'corrected' ? m.correctedSets : m.sets ?? genSets(m);
  return rows.map(([h, a]) => ({ home: h, away: a }));
};

const events = [];
for (const m of matches) {
  events.push({
    id: `R-${m.id}`,
    type: 'matchResult',
    ts: `${m.date}T15:00:00+08:00`,
    matchId: m.id,
    stage: 'group',
    group: m.group,
    home: m.home,
    away: m.away,
    sets: toSets(m, 'original'),
    ...(m.forfeit ? { forfeit: m.forfeit } : {}),
    ...(m.rosterChallenge ? { rosterChallenge: m.rosterChallenge } : {}),
    ...(m.notes ? { notes: m.notes } : {}),
    confirmedBy: { referee: refereeOf(m.group), scorer: `SD-${m.group}-03` },
  });
}

// 登记台账按时间排序（追加记录必须时序单调）；全部事件构造完后执行，见文件末尾
const sortEvents = () =>
  events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.id.localeCompare(b.id));

// 江洲处罚扣分（09-19）
events.push({
  id: 'PEN-JZ-01',
  type: 'penalty',
  ts: '2025-09-19T20:30:00+08:00',
  team: 'JZ',
  points: 2,
  reason: '替补席人员管理违规并延误比赛，按当届规程扣积分 2 分',
});

// 排签抽签：蓝湾/静海归一化战绩完全相同（09-20 晚，技术代表确认）
events.push({
  id: 'DRW-SEED-01',
  type: 'drawOutcome',
  ts: '2025-09-20T20:00:00+08:00',
  stage: 'seed',
  tieKey: 'seed:JH=LW',
  teams: ['LW', 'JH'],
  note: '1 号签抽签：蓝湾抽得 1 号、静海 2 号',
  confirmedBy: { technicalDelegate: 'TD-07' },
});

// QF4 开赛（09-23 晚）
events.push({
  id: 'K-QF4',
  type: 'kickoff',
  ts: '2025-09-23T19:00:00+08:00',
  matchId: 'QF4',
});

// 记分台复核：GB01 改判 3:1 → 3:2
events.push({
  id: 'COR-GB01-01',
  type: 'correction',
  ts: '2025-09-24T10:30:00+08:00',
  matchId: 'GB01',
  stage: 'group',
  group: 'B',
  home: 'SX',
  away: 'HC',
  sets: toSets(matches.find((x) => x.id === 'GB01'), 'corrected'),
  basis: 'refereeReview',
  reason: '记分台与录像复核：原记主队 3:1 有误，客队赢下第四局、主队决胜局获胜，实际为 3:2',
  confirmedBy: { referee: 'R-205', scorer: 'SD-B-03', technicalDelegate: 'TD-07' },
});

// 江洲申诉成立，撤销扣分
events.push({
  id: 'REV-JZ-01',
  type: 'penaltyReversal',
  ts: '2025-09-24T14:00:00+08:00',
  penaltyId: 'PEN-JZ-01',
  reason: '仲裁委员会复核录像，认定不构成延误比赛，撤销扣分',
});

// 台账输出按事实时间排列（补录类记录的 ts 允许早于登记时刻，见 records.replay）
sortEvents();

const teamName = (id) => {
  for (const g of Object.values(T)) if (g[id]) return g[id];
  return id;
};

const tournament = {
  domain: 'volleyball-qualification',
  edition: RULES.edition,
  teams: Object.entries(T).flatMap(([group, rows]) =>
    Object.entries(rows).map(([id, name]) => ({ id, name, group }))
  ),
  groups: [
    {
      id: 'A',
      name: 'A 组',
      teamIds: Object.keys(T.A),
      matchIds: matches.filter((m) => m.group === 'A').map((m) => m.id),
    },
    {
      id: 'B',
      name: 'B 组',
      teamIds: Object.keys(T.B),
      matchIds: matches.filter((m) => m.group === 'B').map((m) => m.id),
    },
    {
      id: 'C',
      name: 'C 组',
      teamIds: Object.keys(T.C),
      matchIds: matches.filter((m) => m.group === 'C').map((m) => m.id),
    },
  ],
  knockout: { quarterfinalIds: RULES.knockout.quarterfinals.map((q) => q.matchId) },
  displayNameOf: Object.fromEntries(
    Object.entries(T).flatMap(([, rows]) => Object.entries(rows).map(([id, name]) => [id, name]))
  ),
};

const v1 = publish(tournament, events, {
  version: 1,
  publishedAt: '2025-09-21T12:00:00+08:00',
  cutoffTs: '2025-09-21T00:00:00+08:00',
  note: '小组赛结束，发布各组成绩、两个成绩最好第三名与八强签位、四分之一决赛对阵',
});

const v2 = publish(
  tournament,
  events,
  {
    version: 2,
    publishedAt: '2025-09-24T21:00:00+08:00',
    note: 'GB01 记分复核改判、江洲申诉撤销扣分后重算：QF1-QF3 重排，QF4 已开赛锁定并列入仲裁冲突',
  },
  [v1]
);

await mkdir(new URL('../fixtures/', import.meta.url), { recursive: true });
await writeFile(new URL('../fixtures/tournament.json', import.meta.url), JSON.stringify(tournament, null, 2) + '\n');
await writeFile(new URL('../fixtures/events.json', import.meta.url), JSON.stringify({ events }, null, 2) + '\n');
await writeFile(
  new URL('../fixtures/publications.json', import.meta.url),
  JSON.stringify({ publications: [v1, v2] }, null, 2) + '\n'
);

// 控制台摘要
const line = (s) => console.log(s);
for (const v of [v1, v2]) {
  line(`\n===== v${v.version}  发布于 ${v.publishedAt} =====`);
  for (const g of v.groups) {
    line(`${g.groupId} 组：` + g.order.map((r) => `${r.rank}.${teamName(r.team)}(${r.points}分)`).join('  '));
  }
  line('第三名比较：' + v.thirdPlace.map((t) => `${t.rankAmongThirds}.${teamName(t.team)}${t.qualified ? '晋级' : '出局'}`).join('  '));
  line('签位：' + v.seeds.map((s) => `${s.seed}=${teamName(s.team)}`).join('  '));
  for (const q of v.quarterfinals) {
    line(`  ${q.matchId}: ${teamName(q.home ?? '?')} vs ${teamName(q.away ?? '?')}${q.locked ? '  [已开赛锁定]' : ''}${q.conflict ? `  冲突:${q.conflict}` : ''}`);
  }
  for (const c of v.conflicts) line(`  ! ${c.type}: ${c.detail}`);
  if (v.pendingDraws.length) line(`  待抽签: ${JSON.stringify(v.pendingDraws)}`);
}
line('\nfixtures 已写入：tournament.json / events.json / publications.json');
