// 不可覆盖的赛果记录层。
//
// 所有事实都是只追加（append-only）的事件，任何更正都不删除旧记录：
//   matchResult     小组赛果（逐局比分；弃权；阵容异议及裁判处置；裁判确认）
//   correction      改判/申诉改判/赛后复核，引用原比赛，整体替换其赛果
//   penalty         处罚扣分
//   penaltyReversal 申诉成立，撤销处罚
//   drawOutcome     抽签结果（平分且规则指标仍无法区分时，由抽签固化顺位）
//   kickoff         比赛开赛（开赛后对阵锁定）
//
// 发布版本不在此层：发布是对“某一时刻之前记录”的快照（见 publication.js）。

export const RECORD_TYPES = [
  'matchResult',
  'correction',
  'penalty',
  'penaltyReversal',
  'drawOutcome',
  'kickoff',
];

export class RecordError extends Error {}

function fail(msg) {
  throw new RecordError(msg);
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

function isNaturalSetScore(h, a, deciding) {
  const win = deciding ? 15 : 25;
  const [winner, loser] = h > a ? [h, a] : [a, h];
  if (winner < win) return false; // 未到点
  if (winner === win) return loser <= win - 2; // 到点收场须净胜 2 分（如 25:23）
  return loser === winner - 2; // 到点后须连胜至净胜 2 分（如 27:25）
}

// 校验一条赛果（比赛原始记录或更正后的记录共用同一结构）。
function validateMatchBody(e, ctx) {
  assert(typeof e.matchId === 'string' && e.matchId.length > 0, '缺少比赛编号 matchId');
  assert(e.stage === 'group' || e.stage === 'knockout', 'stage 必须是 group 或 knockout');
  assert(typeof e.home === 'string' && typeof e.away === 'string', '缺少主客队标识');
  assert(e.home !== e.away, '同队不能互为对手');
  if (ctx?.teamsById) {
    assert(ctx.teamsById.has(e.home), `未知球队 ${e.home}`);
    assert(ctx.teamsById.has(e.away), `未知球队 ${e.away}`);
  }
  assert(Array.isArray(e.sets) && e.sets.length >= 1, '缺少逐局比分');

  if (e.forfeit) {
    assert(e.forfeit === 'home' || e.forfeit === 'away', 'forfeit 只能是 home 或 away');
    // 弃权 canonical：0:3，每局 0:25
    assert(e.sets.length === 3, '弃权比赛须记为三局');
    for (const s of e.sets) {
      const loser = e.forfeit === 'home' ? s.home : s.away;
      const winner = e.forfeit === 'home' ? s.away : s.home;
      assert(loser === 0 && winner === 25, '弃权局须记 25:0');
    }
  } else {
    assert(e.sets.length <= 5, '小组赛为五局三胜，不能超过五局');
    const wins = e.sets.reduce((acc, s) => acc + (s.home > s.away ? 1 : s.away > s.home ? 1 : 0), 0);
    assert(wins === e.sets.length, '每局必须分出胜负');
    const homeWins = e.sets.filter((s) => s.home > s.away).length;
    assert(homeWins === 3 || wins - homeWins === 3, '比赛须以一方先胜三局结束');
    e.sets.forEach((s, i) => {
      const deciding = i === 4;
      assert(
        Number.isInteger(s.home) &&
          Number.isInteger(s.away) &&
          isNaturalSetScore(s.home, s.away, deciding),
        `第 ${i + 1} 局比分 ${s.home}:${s.away} 不符合排球计分规则`
      );
    });
  }

  if (e.rosterChallenge) {
    const rc = e.rosterChallenge;
    assert(rc.raised === 'home' || rc.raised === 'away', '阵容异议须记明提出方');
    assert(['upheld', 'rejected'].includes(rc.disposition), '异议处置须为 upheld 或 rejected');
    // 异议成立 = 被异议方（提出方的对手）0:3 告负，赛果必须相应记为弃权
    if (rc.disposition === 'upheld') {
      assert(e.forfeit && e.forfeit !== rc.raised, '阵容异议成立时，违规方（异议提出方的对手）须记 0:3 弃权');
    }
  }

  assert(e.confirmedBy && typeof e.confirmedBy.referee === 'string', '缺少裁判确认');
}

export function validateEvent(e, ctx) {
  assert(e && typeof e === 'object', '记录必须是对象');
  assert(typeof e.id === 'string' && e.id.length > 0, '缺少记录编号 id');
  assert(typeof e.ts === 'string' && !Number.isNaN(Date.parse(e.ts)), '缺少有效时间戳 ts');
  assert(RECORD_TYPES.includes(e.type), `未知记录类型 ${e.type}`);

  switch (e.type) {
    case 'matchResult':
      validateMatchBody(e, ctx);
      break;
    case 'correction': {
      assert(typeof e.reason === 'string' && e.reason.length > 0, '改判必须说明原因');
      assert(
        ['appeal', 'refereeReview', 'supplement'].includes(e.basis),
        '改判依据 basis 必须是 appeal / refereeReview / supplement'
      );
      validateMatchBody(e, ctx);
      break;
    }
    case 'penalty':
      assert(typeof e.team === 'string', '处罚缺少球队');
      assert(Number.isInteger(e.points) && e.points > 0, '处罚扣分为正整数');
      assert(typeof e.reason === 'string' && e.reason.length > 0, '处罚必须说明原因');
      if (ctx?.teamsById) assert(ctx.teamsById.has(e.team), `未知球队 ${e.team}`);
      break;
    case 'penaltyReversal':
      assert(typeof e.penaltyId === 'string', '撤销处罚必须引用 penaltyId');
      assert(typeof e.reason === 'string' && e.reason.length > 0, '撤销处罚必须说明原因');
      break;
    case 'drawOutcome':
      assert(
        e.stage === 'third' || e.stage === 'seed' || /^group:[A-Za-z0-9_-]+$/.test(e.stage),
        '抽签阶段非法（group:<组号> / third / seed）'
      );
      assert(Array.isArray(e.teams) && e.teams.length >= 2, '抽签至少涉及两队');
      assert(new Set(e.teams).size === e.teams.length, '抽签球队重复');
      assert(typeof e.tieKey === 'string' && e.tieKey.length > 0, '缺少 tieKey');
      assert(e.confirmedBy && typeof e.confirmedBy.technicalDelegate === 'string', '抽签须经技术代表确认');
      break;
    case 'kickoff':
      assert(typeof e.matchId === 'string', '开赛事件缺少比赛编号');
      break;
  }
}

// 把一批记录按时间顺序重放为“当前生效状态”，同时保留完整历史。
// 返回的结构不可当作可编辑表：它是记录的投影，重算即可再生。
export function replay(events, ctx) {
  const state = {
    matches: new Map(), // matchId -> { original, current, history: [] }
    penalties: new Map(), // penaltyId -> { penalty, reversedBy }
    kicks: new Map(), // matchId -> kickoff event
    draws: [], // 抽签记录
    timeline: [...events],
  };

  // 台账按数组顺序追加；ts 是“事实发生时间”，允许早于前一条（赛后补录）。
  // 更正、撤销等引用型记录必须排在被引用记录之后，由下方分支保证。
  const seenIds = new Set();
  for (const e of state.timeline) {
    validateEvent(e, ctx);
    if (seenIds.has(e.id)) fail(`记录编号 ${e.id} 重复`);
    seenIds.add(e.id);

    switch (e.type) {
      case 'matchResult': {
        if (state.matches.has(e.matchId)) fail(`比赛 ${e.matchId} 已有原始记录，不能重复登记`);
        state.matches.set(e.matchId, { original: e, current: e, history: [e] });
        break;
      }
      case 'correction': {
        const m = state.matches.get(e.matchId);
        if (!m) fail(`改判 ${e.id} 引用了不存在的比赛 ${e.matchId}`);
        assert(e.stage === m.original.stage, '更正不能改变比赛阶段');
        assert(e.home === m.original.home && e.away === m.original.away, '更正不能改变对阵双方');
        m.current = e;
        m.history.push(e);
        break;
      }
      case 'penalty': {
        if (state.penalties.has(e.id)) fail(`处罚 ${e.id} 重复`);
        state.penalties.set(e.id, { penalty: e, reversedBy: null });
        break;
      }
      case 'penaltyReversal': {
        const p = state.penalties.get(e.penaltyId);
        if (!p) fail(`撤销 ${e.id} 引用了不存在的处罚 ${e.penaltyId}`);
        if (p.reversedBy) fail(`处罚 ${e.penaltyId} 已被撤销，不能重复撤销`);
        p.reversedBy = e;
        break;
      }
      case 'drawOutcome': {
        // 同一平分集团的抽签结果只能确认一次；
        // 修正若改变了平分集团（成员不同），tieKey 也会不同。
        if (state.draws.some((d) => d.tieKey === e.tieKey)) {
          fail(`抽签键 ${e.tieKey} 已确认，不能重复抽签`);
        }
        state.draws.push(e);
        break;
      }
      case 'kickoff':
        state.kicks.set(e.matchId, e);
        break;
    }
  }

  return state;
}

// 取一场比赛当前生效的赛果数据（对裁判/球队核对时另用 history 展示原貌）。
export function effectiveMatch(state, matchId) {
  const slot = state.matches.get(matchId);
  if (!slot) return null;
  const cur = slot.current;
  const homeWins = cur.sets.filter((s) => s.home > s.away).length;
  const awayWins = cur.sets.length - homeWins;
  return {
    matchId: cur.matchId,
    stage: cur.stage,
    group: cur.group,
    home: cur.home,
    away: cur.away,
    sets: cur.sets,
    forfeit: cur.forfeit ?? null,
    rosterChallenge: cur.rosterChallenge ?? null,
    winner: homeWins > awayWins ? cur.home : cur.away,
    homeWins,
    awayWins,
    homePoints: cur.sets.reduce((n, s) => n + s.home, 0),
    awayPoints: cur.sets.reduce((n, s) => n + s.away, 0),
    recordId: cur.id,
    corrected: cur !== slot.original,
    history: slot.history.map((h) => ({
      recordId: h.id,
      ts: h.ts,
      type: h.type,
      basis: h.basis ?? null,
      reason: h.reason ?? null,
    })),
  };
}

// 当前仍生效的扣分（按球队合计）。
export function activePenaltyPoints(state, teamId) {
  let total = 0;
  const items = [];
  for (const { penalty, reversedBy } of state.penalties.values()) {
    if (penalty.team === teamId && !reversedBy) {
      total += penalty.points;
      items.push(penalty);
    }
  }
  return { total, items };
}

// 生成确定性的平分抽签键（与球队输入顺序无关）。
export function tieKey(stage, teams) {
  return `${stage}:${[...teams].sort().join('=' )}`;
}

// 查询抽签结果：返回该平分集团的确认顺序，未抽签则为 null。
export function drawOrder(state, stage, teams) {
  const key = tieKey(stage, teams);
  const found = state.draws
    .filter((d) => d.stage === stage && d.tieKey === key)
    .at(-1);
  return found ? found.teams : null;
}
