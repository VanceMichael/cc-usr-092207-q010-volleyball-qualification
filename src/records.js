// 赛果记录账本:记录只能追加,不可覆盖。
// 补录是某场比赛的第一条记录;改判是同一 match_id 的新记录并以 supersedes
// 指向被取代的记录;处罚扣分是独立记录。历史记录永远保留,排名只取每场
// 最新一条已确认记录,因此任一历史版本都能按当时的记录集复算。

const MATCH_KINDS = new Set(['result', 'forfeit', 'overturn']);
const KINDS = new Set([...MATCH_KINDS, 'penalty']);
const STATUSES = new Set(['confirmed', 'pending']);

export function createLedger() {
  return { records: [] };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

// 校验单局与整场比分:前四局 25 分制、决胜局 15 分制,须净胜 2 分,
// 一方先胜 3 局即结束,最后一局须由本场胜方获胜。
function validateSets(sets) {
  if (!Array.isArray(sets) || sets.length < 3 || sets.length > 5) {
    throw new Error('局数必须为 3 至 5 局');
  }
  let won1 = 0;
  let won2 = 0;
  sets.forEach((set, i) => {
    if (!Array.isArray(set) || set.length !== 2 || !set.every((n) => Number.isInteger(n) && n >= 0)) {
      throw new Error(`第 ${i + 1} 局得分须为非负整数对`);
    }
    const [a, b] = set;
    const target = i === 4 ? 15 : 25;
    if (Math.max(a, b) < target || Math.abs(a - b) < 2) {
      throw new Error(`第 ${i + 1} 局比分无效: ${a}:${b}`);
    }
    if (i === sets.length - 1 && Math.max(won1, won2) >= 3) {
      throw new Error('比赛在分出胜负后不得继续登记局分');
    }
    if (a > b) won1 += 1; else won2 += 1;
  });
  if (Math.max(won1, won2) !== 3) throw new Error('比赛须有一方先胜 3 局');
  const lastSetWonBy1 = sets[sets.length - 1][0] > sets[sets.length - 1][1];
  if ((won1 === 3) !== lastSetWonBy1) throw new Error('最后一局须由本场胜方获胜');
}

export function validateRecord(record) {
  if (!record || typeof record !== 'object') throw new Error('记录必须是对象');
  if (!record.record_id) throw new Error('记录缺少 record_id');
  if (!KINDS.has(record.kind)) throw new Error(`未知记录类型: ${record.kind}`);
  if (!STATUSES.has(record.status)) throw new Error(`未知记录状态: ${record.status}`);
  if (!record.recorded_at) throw new Error('记录缺少登记时间 recorded_at');
  if (record.status === 'confirmed' && !record.confirmed_by) {
    throw new Error('已确认记录须注明裁判/技术代表确认人');
  }
  if (record.kind === 'penalty') {
    if (!record.penalty || !record.penalty.team || !Number.isFinite(record.penalty.points)) {
      throw new Error('处罚记录须注明队伍与扣分');
    }
    if (!record.reason) throw new Error('处罚记录须注明原因');
    return record;
  }
  // 比赛类记录
  if (!record.match_id) throw new Error('比赛记录缺少 match_id');
  if (!Array.isArray(record.teams) || record.teams.length !== 2 || record.teams[0] === record.teams[1]) {
    throw new Error('比赛记录须包含两支不同队伍');
  }
  validateSets(record.sets);
  if (record.kind === 'forfeit') {
    if (!record.teams.includes(record.forfeit_by)) throw new Error('弃权方须为参赛队伍之一');
    if (!record.reason) throw new Error('弃权记录须注明原因');
  }
  if (record.kind === 'overturn' && !record.supersedes) {
    throw new Error('改判记录须以 supersedes 指向被取代的记录');
  }
  return record;
}

// 追加一条记录,返回新账本;原账本与已有记录保持不变。
export function appendRecord(ledger, record) {
  const checked = validateRecord(record);
  if (ledger.records.some((r) => r.record_id === checked.record_id)) {
    throw new Error(`记录编号重复: ${checked.record_id}`);
  }
  if (checked.supersedes && !ledger.records.some((r) => r.record_id === checked.supersedes)) {
    throw new Error(`被取代的记录不存在: ${checked.supersedes}`);
  }
  const stored = deepFreeze({ ...checked, seq: ledger.records.length + 1 });
  return { records: [...ledger.records, stored] };
}

export function appendRecords(ledger, records) {
  return records.reduce((acc, r) => appendRecord(acc, r), ledger);
}

// 当前生效记录:每场比赛取最新一条已确认记录;处罚记录全部生效;
// 待确认(pending)记录保留在账本中但不参与计算。
export function effectiveRecords(ledger) {
  const byMatch = new Map();
  const penalties = [];
  for (const r of ledger.records) {
    if (r.status !== 'confirmed') continue;
    if (r.kind === 'penalty') penalties.push(r);
    else byMatch.set(r.match_id, r);
  }
  return { results: [...byMatch.values()], penalties };
}

// 球队核对自己的原始记录:返回涉及该队的全部记录(含被取代与待确认的)。
export function teamRecords(ledger, teamId) {
  return ledger.records.filter(
    (r) => (r.teams && r.teams.includes(teamId)) || (r.penalty && r.penalty.team === teamId),
  );
}
