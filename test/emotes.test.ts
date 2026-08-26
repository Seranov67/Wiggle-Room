import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { EMOTES, playReaction, REACTION_EMOTES } from '../src/game/emotes.ts'
import { PROMPTS } from '../src/game/prompts.ts'
import { REACTIONS } from '../src/config.ts'
import { clearEmotes, emotesFired } from './harness/sdk-restricted.ts'

describe('the reaction set', () => {
  // `triggerEmote` takes a plain string and resolves either way, so a
  // misspelled id does nothing and says nothing about it — the same silent
  // failure a missing permission produced for this scene's entire life.
  it('offers only emotes the client actually has', () => {
    assert.ok(REACTION_EMOTES.length > 0)
    for (const reaction of REACTION_EMOTES) {
      assert.ok(
        EMOTES.some((e) => e.id === reaction.id),
        `${reaction.id} is not in the emote set`
      )
    }
  })

  // A reaction that is also what the actor is most likely to be miming reads
  // as a second performance. Computed rather than hardcoded, so this starts
  // failing if the prompt library shifts its weight onto a reaction emote.
  it('keeps clear of the emotes the prompts lean on hardest', () => {
    const uses = new Map<string, number>()
    for (const prompt of PROMPTS) {
      for (const id of prompt.suggests) uses.set(id, (uses.get(id) ?? 0) + 1)
    }
    const hottest = [...uses.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id)

    for (const reaction of REACTION_EMOTES) {
      assert.ok(!hottest.includes(reaction.id), `${reaction.id} is among the three most-mimed emotes`)
    }
  })

  it('gives each one a label written for a reaction, not for the wheel', () => {
    for (const reaction of REACTION_EMOTES) {
      assert.notEqual(reaction.label, '')
      assert.ok(reaction.label.length <= 6, `${reaction.label} will not fit a narrow tile`)
    }
  })
})

describe('the reaction cooldown', () => {
  it('fires the emote that was asked for', () => {
    clearEmotes()
    assert.equal(playReaction('clap', 100_000), true)
    assert.deepEqual(emotesFired(), ['clap'])
  })

  it('swallows a second press while the first is still playing', () => {
    clearEmotes()
    playReaction('clap', 200_000)
    assert.equal(playReaction('dab', 200_000 + REACTIONS.cooldownMs - 1), false)
    assert.deepEqual(emotesFired(), ['clap'], 'a mashed button must not strobe the room')
  })

  it('lets the next one through once the cooldown has passed', () => {
    clearEmotes()
    playReaction('clap', 300_000)
    assert.equal(playReaction('dab', 300_000 + REACTIONS.cooldownMs), true)
    assert.deepEqual(emotesFired(), ['clap', 'dab'])
  })
})
