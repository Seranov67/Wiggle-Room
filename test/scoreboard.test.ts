import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { ensureScore, findScore, parseScores, ranked, serialiseScores } from '../src/game/scoreboard.ts'

describe('parseScores', () => {
  it('reads an empty scoreboard as no rows', () => {
    assert.deepEqual(parseScores(''), [])
  })

  it('round-trips through serialise', () => {
    const rows = [
      { userId: '0xAAA', score: 340, streak: 2, lastGained: 125 },
      { userId: '0xBBB', score: 0, streak: 0, lastGained: 0 }
    ]
    assert.deepEqual(parseScores(serialiseScores(rows)), rows)
  })

  // The scoreboard crosses the network as one string written by the host. A
  // malformed chunk must cost us that one row, never the whole board.
  it('skips malformed records instead of throwing', () => {
    // Three of the five chunks are junk: too few fields, empty, too many.
    const rows = parseScores('0xAAA:100:1:50;garbage;0xBBB:200:0:0;;a:b:c:d:e')
    assert.equal(rows.length, 2)
    assert.equal(rows[0].userId, '0xAAA')
    assert.equal(rows[1].userId, '0xBBB')
  })

  it('reads unparseable numbers as zero rather than NaN', () => {
    const rows = parseScores('0xAAA:not-a-number:x:y')
    assert.equal(rows[0].score, 0)
    assert.equal(rows[0].streak, 0)
    assert.equal(rows[0].lastGained, 0)
  })
})

describe('serialiseScores', () => {
  it('rounds fractional scores, since the wire format is integers', () => {
    const out = serialiseScores([{ userId: '0xAAA', score: 100.6, streak: 1, lastGained: 12.4 }])
    assert.equal(out, '0xAAA:101:1:12')
  })
})

describe('findScore / ensureScore', () => {
  it('matches userIds case-insensitively — addresses arrive in mixed case', () => {
    const rows = [{ userId: '0xAbCd', score: 10, streak: 0, lastGained: 0 }]
    assert.ok(findScore(rows, '0xabcd') !== null)
    assert.ok(findScore(rows, '0xABCD') !== null)
  })

  it('appends a zeroed row for an unknown player', () => {
    const rows = [{ userId: '0xAAA', score: 10, streak: 0, lastGained: 0 }]
    const fresh = ensureScore(rows, '0xBBB')
    assert.equal(rows.length, 2)
    assert.deepEqual(fresh, { userId: '0xBBB', score: 0, streak: 0, lastGained: 0 })
  })

  it('does not duplicate an existing player', () => {
    const rows = [{ userId: '0xAAA', score: 10, streak: 0, lastGained: 0 }]
    const found = ensureScore(rows, '0xaaa')
    assert.equal(rows.length, 1)
    assert.equal(found.score, 10)
  })
})

describe('ranked', () => {
  it('sorts by score descending', () => {
    const rows = [
      { userId: '0xA', score: 10, streak: 0, lastGained: 0 },
      { userId: '0xB', score: 300, streak: 0, lastGained: 0 },
      { userId: '0xC', score: 120, streak: 0, lastGained: 0 }
    ]
    assert.deepEqual(
      ranked(rows).map((r) => r.userId),
      ['0xB', '0xC', '0xA']
    )
  })

  // Every client renders the scoreboard from the same string, so a tie must
  // break the same way everywhere or players see different standings.
  it('breaks ties by userId so all clients agree', () => {
    const rows = [
      { userId: '0xZZZ', score: 100, streak: 0, lastGained: 0 },
      { userId: '0xAAA', score: 100, streak: 0, lastGained: 0 }
    ]
    assert.deepEqual(
      ranked(rows).map((r) => r.userId),
      ['0xAAA', '0xZZZ']
    )
  })

  it('leaves the caller’s array untouched', () => {
    const rows = [
      { userId: '0xA', score: 10, streak: 0, lastGained: 0 },
      { userId: '0xB', score: 300, streak: 0, lastGained: 0 }
    ]
    ranked(rows)
    assert.equal(rows[0].userId, '0xA')
  })
})
