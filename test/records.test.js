import test from 'node:test';
import assert from 'node:assert/strict';
import { matchEvent, win30 } from './util.js';
import { RecordError, effectiveMatch, replay } from '../src/records.js';

const base = { matchId: 'M1', home: 'A', away: 'B' };

test('正常 3:0 / 3:1 / 3:2 的逐局比分校验通过', () => {
  assert.doesNotThrow(() =>
    replay([matchEvent({ ...base, sets: win30() })], { teamsById: new Set(['A', 'B']) })
  );
  assert.doesNotThrow(() =>
    replay(
      [
        matchEvent({
          ...base,
          sets: [
            [25, 23],
            [25, 20],
            [20, 25],
            [25, 21],
          ],
        }),
      ],
      { teamsById: new Set(['A', 'B']) }
    )
  );
  assert.doesNotThrow(() =>
    replay(
      [
        matchEvent({
          ...base,
          sets: [
            [23, 25],
            [25, 21],
            [25, 19],
            [19, 25],
            [15, 12],
          ],
        }),
      ],
      { teamsById: new Set(['A', 'B']) }
    )
  );
});

test('非法局比分（25:24、24:24、25:23 后未到点等）被拒', () => {
  const rejects = (sets, msg) => {
    assert.throws(
      () => replay([matchEvent({ ...base, sets })], { teamsById: new Set(['A', 'B']) }),
      RecordError,
      msg
    );
  };
  rejects([[25, 24]], '25:24 未净胜两分');
  rejects([[24, 24]], '24:24 必须继续到净胜 2 分');
  rejects(
    [
      [25, 20],
      [25, 20],
      [20, 25],
      [26, 25],
    ],
    '26:25 仍未净胜 2 分'
  );
  rejects(
    [
      [25, 20],
      [5, 25],
      [25, 20],
    ],
    '非弃权赛果不能记 3 局内异常低分'
  );
});

test('弃权统一记 0:3（每局 0:25），阵容异议成立对应被异议方弃权', () => {
  const ok = replay(
    [
      matchEvent({
        ...base,
        forfeit: 'away',
        sets: [
          [25, 0],
          [25, 0],
          [25, 0],
        ],
        rosterChallenge: { raised: 'home', disposition: 'upheld' },
      }),
    ],
    { teamsById: new Set(['A', 'B']) }
  );
  const m = effectiveMatch(ok, 'M1');
  assert.equal(m.winner, 'A');
  assert.equal(m.homeWins, 3);
  assert.equal(m.awayPoints, 0);
  assert.equal(m.corrected, false);

  assert.throws(
    () =>
      replay(
        [
          matchEvent({
            ...base,
            forfeit: 'away',
            sets: [
              [25, 0],
              [25, 0],
              [25, 0],
            ],
            rosterChallenge: { raised: 'away', disposition: 'upheld' },
          }),
        ],
        { teamsById: new Set(['A', 'B']) }
      ),
    RecordError
  );
});

test('改判引用原比赛且不能改变对阵；原记录与更正记录都保留在 history', () => {
  const orig = matchEvent({ ...base, sets: win30() });
  const corrected = matchEvent({
    id: 'COR-M1',
    ...base,
    ts: '2025-09-11T10:00:00+08:00',
    type: 'correction',
    basis: 'appeal',
    reason: '录像复核',
    sets: [
      [23, 25],
      [25, 21],
      [25, 19],
      [19, 25],
      [15, 12],
    ],
  });
  const state = replay([orig, corrected], { teamsById: new Set(['A', 'B']) });
  const m = effectiveMatch(state, 'M1');
  assert.equal(m.recordId, corrected.id);
  assert.equal(m.corrected, true);
  assert.equal(m.history.length, 2);
  assert.deepEqual(m.history.map((h) => h.type), ['matchResult', 'correction']);

  // 改变对阵的更正被拒
  const tampered = { ...corrected, away: 'C' };
  assert.throws(() => replay([orig, tampered], { teamsById: new Set(['A', 'B']) }), RecordError);
});

test('重复登记、重复撤销、引用不存在比赛均被拒', () => {
  const e1 = matchEvent({ ...base, sets: win30() });
  assert.throws(() => replay([e1, { ...e1, id: 'X' }], { teamsById: new Set(['A', 'B']) }), RecordError);

  const pen = { id: 'P1', type: 'penalty', ts: '2025-09-10T12:00:00+08:00', team: 'A', points: 2, reason: 'r' };
  const rev = { id: 'V1', type: 'penaltyReversal', ts: '2025-09-10T13:00:00+08:00', penaltyId: 'P1', reason: 'r' };
  assert.doesNotThrow(() => replay([pen, rev], { teamsById: new Set(['A', 'B']) }));
  assert.throws(() => replay([pen, rev, { ...rev, id: 'V2' }], { teamsById: new Set(['A', 'B']) }), RecordError);
  assert.throws(
    () => replay([{ ...matchEvent({ ...base, sets: win30() }), matchId: 'M9' },
      { ...matchEvent({ ...base, sets: win30(), type: 'correction', basis: 'supplement', reason: 'x' }) }],
      { teamsById: new Set(['A', 'B']) }),
    RecordError
  );
});

test('赛后补录允许 ts 早于已登记记录（追加顺序即台账顺序）', () => {
  const m2 = matchEvent({ matchId: 'M2', home: 'A', away: 'C', ts: '2025-09-12T10:00:00+08:00', sets: win30() });
  // M1 比赛更早，但 09-13 才补登记
  const m1Supplement = matchEvent({
    id: 'R-M1-LATE',
    matchId: 'M1',
    home: 'A',
    away: 'B',
    ts: '2025-09-10T10:00:00+08:00',
    sets: win30(1),
  });
  const state = replay([m2, m1Supplement], { teamsById: new Set(['A', 'B', 'C']) });
  assert.equal(state.matches.size, 2);
});
