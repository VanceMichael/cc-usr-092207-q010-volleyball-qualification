// 解释模块:面对任一历史版本,说明某队为何晋级、为何落在该签位,
// 以及一次规则或赛果修正影响了谁。
import { diffVersions } from './versions.js';

function findInStandings(version, teamId) {
  for (const g of version.standings) {
    const idx = g.rows.findIndex((r) => r.team === teamId);
    if (idx >= 0) return { group: g.group, row: g.rows[idx], rank: idx + 1, decisions: g.decisions };
  }
  return null;
}

function decisionLines(version, decisions, teamId, nameOf) {
  const lines = [];
  for (const d of decisions) {
    if (!d.between.includes(teamId)) continue;
    const mineFirst = d.between[0] === teamId;
    const other = nameOf(mineFirst ? d.between[1] : d.between[0]);
    const mine = mineFirst ? d.aText : d.bText;
    const theirs = mineFirst ? d.bText : d.aText;
    if (d.criterion === 'lot') {
      lines.push(`与${other}各项数据完全相同,按规则以抽签决定先后(示例按队伍编号落位)。`);
    } else {
      lines.push(`与${other}比较:${d.label} ${mine} 对 ${theirs},故排其${mineFirst ? '前' : '后'}。`);
    }
  }
  return lines;
}

const recordLine = (row, nameOf) =>
  `${nameOf(row.team)}: ${row.wins}胜${row.losses}负,积分${row.points},胜负局${row.setsWon}:${row.setsLost},得失分${row.pointsWon}:${row.pointsLost}`;

// 说明某队在该版本中的完整晋级逻辑。
export function explainTeam(version, teamId) {
  const nameOf = (id) => (version.teamNames && version.teamNames[id]) || id;
  const found = findInStandings(version, teamId);
  if (!found) throw new Error(`该版本中没有队伍: ${teamId}`);
  const { group, row, rank, decisions } = found;
  const lines = [];
  const me = nameOf(teamId);

  lines.push(`${me} 在 ${group} 组出战 ${row.played} 场,${row.wins} 胜 ${row.losses} 负,`
    + `积分 ${row.points},胜负局 ${row.setsWon}:${row.setsLost},得失分 ${row.pointsWon}:${row.pointsLost},列小组第 ${rank} 名。`);
  if (row.penaltyPoints !== 0) {
    const why = row.penalties.map((p) => `${p.record_id}(${p.reason})`).join('、');
    lines.push(`其中含处罚扣分 ${row.penaltyPoints} 分,依据记录 ${why}。`);
  }
  lines.push(...decisionLines(version, decisions, teamId, nameOf));

  const adv = version.advancement;
  const directCut = adv.direct.filter((d) => d.group === group).length;
  if (rank <= directCut) {
    lines.push(`作为 ${group} 组前 ${directCut} 名直接晋级八强。`);
  } else if (rank === directCut + 1) {
    lines.push('以小组第三名身份参加跨组比较,各组第三名成绩如下:');
    adv.thirds.rows.forEach((r, i) => {
      const mark = adv.thirds.advanced.includes(r.team) ? '晋级' : '淘汰';
      lines.push(`  第 ${i + 1} 位:${recordLine(r, nameOf)} —— ${mark}`);
    });
    lines.push(...decisionLines(version, adv.thirds.decisions, teamId, nameOf));
    if (adv.thirds.advanced.includes(teamId)) {
      lines.push('在小组第三名中位列前二,以成绩最好的第三名晋级八强。');
    } else {
      lines.push('在小组第三名中未能进入前二,止步小组赛。');
    }
  } else {
    lines.push(`小组第 ${rank} 名,不在晋级范围内,止步小组赛。`);
  }

  const seedEntry = adv.seeds.find((s) => s.team === teamId);
  if (seedEntry) {
    lines.push(`八强排签列第 ${seedEntry.seed} 号签。`);
    lines.push(...decisionLines(version, adv.seedDecisions, teamId, nameOf));
    const slot = version.bracket.find((s) => s.home === teamId || s.away === teamId);
    if (slot) {
      const locked = slot.locked ? '(该场已开赛,签位锁定)' : '';
      lines.push(`四分之一决赛 ${slot.slot}:${nameOf(slot.home)} 对 ${nameOf(slot.away)}${locked}。`);
    }
  }
  return lines;
}

// 说明一次修正(补录/处罚/改判)从上一版本到本版本影响了谁。
export function explainDiff(prev, next) {
  const nameOf = (id) => (next.teamNames && next.teamNames[id]) || id;
  const diff = diffVersions(prev, next);
  const lines = [];
  lines.push(`版本 ${prev.version} → ${next.version}(发布时间 ${next.published_at},规则 ${next.rules_id})。`);
  lines.push(`新增记录:${diff.newRecords.length ? diff.newRecords.join('、') : '无'}。`);
  for (const c of diff.changes) {
    if (c.type === 'advanced') lines.push(`${nameOf(c.team)} 由未晋级变为晋级,落第 ${c.seed} 号签。`);
    else if (c.type === 'eliminated') lines.push(`${nameOf(c.team)} 由第 ${c.wasSeed} 号签变为未晋级。`);
    else lines.push(`${nameOf(c.team)} 签位由第 ${c.from} 号变为第 ${c.to} 号。`);
  }
  if (diff.rearranged.length) lines.push(`以下未开赛对阵按新结果重排:${diff.rearranged.join('、')}。`);
  for (const c of diff.conflicts) {
    lines.push(`${c.slot} 已开赛,签位锁定为 ${nameOf(c.kept.home)} 对 ${nameOf(c.kept.away)};`
      + `按新结果应为 ${nameOf(c.computed.home)} 对 ${nameOf(c.computed.away)},${c.reason}。`);
  }
  if (!diff.changes.length && !diff.rearranged.length && !diff.conflicts.length) {
    lines.push('本次修正不影响晋级名单与签位。');
  }
  return lines;
}

// 版本总览:发布时间、依据规则、签位与对阵。
export function explainVersion(version) {
  const nameOf = (id) => (version.teamNames && version.teamNames[id]) || id;
  const lines = [];
  lines.push(`第 ${version.version} 版,发布时间 ${version.published_at},依据规则 ${version.rules_id},纳入记录 ${version.record_ids.length} 条。`);
  lines.push('八强签位:');
  for (const s of version.advancement.seeds) {
    lines.push(`  第 ${s.seed} 号签:${nameOf(s.team)}(${s.group} 组,${s.path === 'group-top' ? '小组前二' : '最佳第三名'})`);
  }
  lines.push('四分之一决赛对阵:');
  for (const s of version.bracket) {
    const locked = s.locked ? '(已开赛,签位锁定)' : '';
    lines.push(`  ${s.slot}:${nameOf(s.home)} 对 ${nameOf(s.away)}${locked}`);
  }
  return lines;
}
