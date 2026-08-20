import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { buildRound, makeRng, packForDay, PACK_NAMES, PROMPTS, PROMPTS_BY_ID } from '../src/game/prompts.ts'

const DAY_MS = 86_400_000

describe('the prompt library', () => {
  it('has no duplicate ids — ids travel on the wire and index the scoreboard', () => {
    const seen = new Set<string>()
    for (const p of PROMPTS) {
      assert.ok(!seen.has(p.id), `duplicate prompt id: ${p.id}`)
      seen.add(p.id)
    }
  })

  it('suggests only emotes that exist in the wheel', () => {
    // Hard-coded rather than imported: emotes.ts pulls in ~system/RestrictedActions,
    // which does not resolve outside the Decentraland runtime.
    const emoteIds = new Set([
      'wave', 'clap', 'raiseHand', 'shrug', 'dontsee', 'headexplode', 'money', 'kiss',
      'fistpump', 'hammer', 'robot', 'disco', 'handsair', 'tektonik', 'dab', 'tik'
    ])
    for (const p of PROMPTS) {
      for (const id of p.suggests) {
        assert.ok(emoteIds.has(id), `prompt ${p.id} suggests unknown emote "${id}"`)
      }
    }
  })

  // buildRound draws three decoys from the answer's own pack. A pack of fewer
  // than four would silently fall back to filler and make rounds easier.
  it('gives every pack at least four prompts', () => {
    for (const pack of Object.keys(PACK_NAMES)) {
      const size = PROMPTS.filter((p) => p.pack === pack).length
      assert.ok(size >= 4, `pack ${pack} has only ${size} prompts`)
    }
  })
})

describe('makeRng', () => {
  it('is deterministic for a seed — every client must rebuild the same round', () => {
    const a = makeRng(12345)
    const b = makeRng(12345)
    for (let i = 0; i < 100; i++) assert.equal(a(), b())
  })

  it('differs between seeds', () => {
    assert.notEqual(makeRng(1)(), makeRng(2)())
  })

  it('stays inside [0, 1)', () => {
    const rng = makeRng(99)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      assert.ok(v >= 0 && v < 1, `out of range: ${v}`)
    }
  })
})

describe('buildRound', () => {
  it('offers exactly four distinct options containing the answer', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { answerId, optionIds } = buildRound(makeRng(seed))
      assert.equal(optionIds.length, 4)
      assert.equal(new Set(optionIds).size, 4, `seed ${seed} repeated an option`)
      assert.ok(optionIds.includes(answerId), `seed ${seed} dropped the answer`)
    }
  })

  it('only ever offers real prompt ids', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const id of buildRound(makeRng(seed)).optionIds) {
        assert.ok(PROMPTS_BY_ID[id] !== undefined, `unknown prompt id ${id}`)
      }
    }
  })

  // Same-pack decoys are what makes a round hard; random ones are too easy to
  // eliminate. This is a gameplay guarantee, not an implementation detail.
  it('draws decoys from the answer’s own pack', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { answerId, optionIds } = buildRound(makeRng(seed))
      const pack = PROMPTS_BY_ID[answerId].pack
      for (const id of optionIds) {
        assert.equal(PROMPTS_BY_ID[id].pack, pack, `seed ${seed} mixed packs`)
      }
    }
  })

  it('honours the featured pack when one is asked for', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { answerId } = buildRound(makeRng(seed), [], 'movies')
      assert.equal(PROMPTS_BY_ID[answerId].pack, 'movies')
    }
  })

  it('avoids recently used prompts', () => {
    const used = PROMPTS.filter((p) => p.pack === 'party').map((p) => p.id)
    for (let seed = 0; seed < 50; seed++) {
      const { answerId } = buildRound(makeRng(seed), used)
      assert.ok(!used.includes(answerId), `seed ${seed} reused ${answerId}`)
    }
  })

  // Falling back is the point: a theme must not be able to stall a round once
  // its pack has been used up.
  it('falls back to the whole library when the featured pack is exhausted', () => {
    const used = PROMPTS.filter((p) => p.pack === 'movies').map((p) => p.id)
    const { answerId, optionIds } = buildRound(makeRng(7), used, 'movies')
    assert.equal(optionIds.length, 4)
    assert.notEqual(PROMPTS_BY_ID[answerId].pack, 'movies')
  })

  it('is reproducible for a given seed', () => {
    const first = buildRound(makeRng(4242))
    const second = buildRound(makeRng(4242))
    assert.deepEqual(first, second)
  })
})

describe('packForDay', () => {
  it('is stable within a day and changes the next', () => {
    const noon = Date.UTC(2026, 7, 15, 12)
    assert.equal(packForDay(0, noon), packForDay(0, noon + 3 * 3600_000))
    assert.notEqual(packForDay(0, noon), packForDay(1, noon))
  })

  it('cycles through every pack, hitting each one', () => {
    const start = Date.UTC(2026, 7, 15)
    const seen = new Set<string>()
    for (let d = 0; d < 8; d++) seen.add(packForDay(0, start + d * DAY_MS))
    assert.equal(seen.size, Object.keys(PACK_NAMES).length)
  })

  it('names a pack that actually exists, including before the epoch', () => {
    for (let d = -400; d < 400; d++) {
      const pack = packForDay(0, Date.UTC(2026, 7, 15) + d * DAY_MS)
      assert.ok(PACK_NAMES[pack] !== undefined, `unknown pack ${pack}`)
    }
    // A negative day number must not produce a negative array index.
    assert.ok(PACK_NAMES[packForDay(0, -5 * DAY_MS)] !== undefined)
  })
})

describe('a themed match', () => {
  // Regression: startRound used to add all four options to the used list, not
  // just the answer. That burned through the featured pack four times faster
  // than necessary, so the day's theme quietly stopped applying around round
  // three of eight while the lobby still advertised it.
  it('stays on the featured pack for a whole eight-round match', () => {
    const used: string[] = []
    const packs: string[] = []

    for (let round = 0; round < 8; round++) {
      const { answerId } = buildRound(makeRng(round * 7919 + 1), used, 'internet')
      packs.push(PROMPTS_BY_ID[answerId].pack)
      used.push(answerId)
      while (used.length > 12) used.shift()
    }

    for (const pack of packs) {
      assert.equal(pack, 'internet', `drifted off theme: ${packs.join(', ')}`)
    }
  })

  it('never repeats an answer inside one match', () => {
    const used: string[] = []
    const answers: string[] = []

    for (let round = 0; round < 8; round++) {
      const { answerId } = buildRound(makeRng(round * 104729 + 5), used, 'everyday')
      assert.ok(!answers.includes(answerId), `round ${round} repeated ${answerId}`)
      answers.push(answerId)
      used.push(answerId)
    }
  })
})
