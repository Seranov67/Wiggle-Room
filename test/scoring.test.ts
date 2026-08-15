import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { speedBonus, streakMultiplier } from '../src/game/scoring.ts'
import { SCORING, TIMING } from '../src/config.ts'

const TABLE = SCORING.streakMultipliers

describe('streakMultiplier', () => {
  it('treats the first correct guess as no streak yet', () => {
    assert.equal(streakMultiplier(1, TABLE), TABLE[0])
  })

  it('clamps a zero or negative streak to the first entry', () => {
    assert.equal(streakMultiplier(0, TABLE), TABLE[0])
    assert.equal(streakMultiplier(-5, TABLE), TABLE[0])
  })

  it('steps through the table', () => {
    assert.equal(streakMultiplier(2, TABLE), TABLE[1])
    assert.equal(streakMultiplier(3, TABLE), TABLE[2])
  })

  it('holds at the last entry rather than running off the end', () => {
    const last = TABLE[TABLE.length - 1]
    assert.equal(streakMultiplier(TABLE.length, TABLE), last)
    assert.equal(streakMultiplier(999, TABLE), last)
  })

  it('never rewards a longer streak less than a shorter one', () => {
    for (let s = 1; s < 20; s++) {
      assert.ok(streakMultiplier(s + 1, TABLE) >= streakMultiplier(s, TABLE))
    }
  })

  it('survives an empty table', () => {
    assert.equal(streakMultiplier(3, []), 1)
  })
})

describe('speedBonus', () => {
  const MAX = SCORING.maxSpeedBonus
  const ACT = TIMING.actMs

  it('pays the full bonus for an instant answer', () => {
    assert.equal(speedBonus(0, ACT, MAX), MAX)
  })

  it('pays nothing at the buzzer', () => {
    assert.equal(speedBonus(ACT, ACT, MAX), 0)
  })

  it('halves at the halfway point', () => {
    assert.equal(speedBonus(ACT / 2, ACT, MAX), MAX / 2)
  })

  // A guess logged after the phase ended is not a hypothetical: a slow frame or
  // a late clock can produce one, and it must not turn into a negative score.
  it('never goes negative past the end of the phase', () => {
    assert.equal(speedBonus(ACT * 2, ACT, MAX), 0)
    assert.equal(speedBonus(Number.MAX_SAFE_INTEGER, ACT, MAX), 0)
  })

  it('never exceeds the maximum, even for a negative timestamp', () => {
    assert.equal(speedBonus(-1000, ACT, MAX), MAX)
  })

  it('decays monotonically', () => {
    let previous = Infinity
    for (let ms = 0; ms <= ACT; ms += ACT / 20) {
      const bonus = speedBonus(ms, ACT, MAX)
      assert.ok(bonus <= previous)
      previous = bonus
    }
  })

  it('returns zero rather than dividing by a zero-length phase', () => {
    assert.equal(speedBonus(100, 0, MAX), 0)
  })
})
