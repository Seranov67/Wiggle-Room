import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRoom, type Room } from './harness/room.ts'
import { PROTOCOL_VERSION, RULES, TIMING } from '../src/config.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tick until the match reaches `phase`, and say what it was stuck in if it never does. */
function runUntil(room: Room, phase: string, budgetMs = 120_000): void {
  let spent = 0
  while (room.phaseName() !== phase) {
    room.tick(0.1)
    spent += 100
    if (spent > budgetMs) throw new Error('stuck in ' + room.phaseName() + ' waiting for ' + phase)
  }
}

/** Tick until round `index` is being picked. */
function runUntilRound(room: Room, index: number, budgetMs = 120_000): void {
  let spent = 0
  while (!(room.roundIndex() === index && room.phaseName() === 'Pick')) {
    room.tick(0.1)
    spent += 100
    if (spent > budgetMs) {
      throw new Error('stuck at round ' + room.roundIndex() + ' / ' + room.phaseName() + ' waiting for ' + index)
    }
  }
}

/** A room already in round 0's pick phase. */
async function roomInRound(...players: Array<[string, string]>): Promise<Room> {
  const room = createRoom()
  for (const [userId, name] of players) await room.join(userId, name)
  room.settle()
  runUntil(room, 'Pick')
  return room
}

/** Get the current round as far as the act phase, with the actor's answer locked. */
function beginAct(room: Room): { actor: string; answer: string } {
  const actor = room.actorId()
  const answer = room.options()[0]
  room.choose(actor, answer)
  room.tick(0.1)
  assert.equal(room.phaseName(), 'Act')
  return { actor, answer }
}

/** Everyone in the room except the actor. */
function guessers(room: Room, actor: string): string[] {
  return room.clients.map((c) => c.userId).filter((id) => id.toLowerCase() !== actor.toLowerCase())
}

/** Play the current round out: the actor picks, and everyone still here reads them right. */
function playRoundOut(room: Room): { actor: string; answer: string } {
  const { actor, answer } = beginAct(room)
  for (const id of guessers(room, actor)) room.guess(id, answer)
  room.tick(0.1)
  return { actor, answer }
}

// ---------------------------------------------------------------------------
// The baseline: a match nobody interferes with
// ---------------------------------------------------------------------------

describe('a match starting', () => {
  it('waits in the lobby for a second player', async () => {
    const room = createRoom()
    await room.join('0xaaa', 'Ana')
    room.settle()
    assert.equal(room.phaseName(), 'Lobby')
  })

  it('starts on its own once the second player arrives', async () => {
    const room = createRoom()
    await room.join('0xaaa', 'Ana')
    room.settle()
    await room.join('0xbbb', 'Bo')
    room.settle()
    assert.equal(room.phaseName(), 'Starting')

    room.advance(TIMING.lobbyCountdownMs + 200)
    assert.equal(room.phaseName(), 'Pick')
    assert.equal(room.roundIndex(), 0)
    assert.equal(room.options().length, 4)
  })
})

describe('a round played through', () => {
  it('scores a correct guess and reveals the answer', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'])
    const { actor, answer } = beginAct(room)
    const guesser = guessers(room, actor)[0]

    room.guess(guesser, answer)
    room.tick(0.1)

    assert.equal(room.phaseName(), 'Reveal', 'everyone guessed, so the round resolves early')
    assert.equal(room.answerId(), answer)
    assert.ok(room.scoreOf(guesser) >= 100, 'the guesser scored')
    assert.ok(room.scoreOf(actor) > 0, 'the actor scored for being read')
  })

  it('pays the actor only the floor when the guess is wrong', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'])
    const { actor, answer } = beginAct(room)
    const guesser = guessers(room, actor)[0]

    room.guess(guesser, room.wrongOption(answer))
    room.tick(0.1)

    assert.equal(room.phaseName(), 'Reveal')
    assert.equal(room.scoreOf(guesser), 0)
    assert.equal(room.scoreOf(actor), 10, 'the actor still gets the floor')
  })
})

// ---------------------------------------------------------------------------
// Somebody leaves
// ---------------------------------------------------------------------------

describe('the actor walks out', () => {
  it('voids the round through the reveal when they go during the pick', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    const actor = room.actorId()

    room.disconnect(actor)
    runUntil(room, 'Reveal')

    assert.equal(room.answerId(), '', 'a voided round has nothing to reveal')
    assert.equal(room.scoreOf('0xbbb'), 0, 'a voided round pays nobody')
  })

  it('voids the round when they go mid-performance', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    const { actor, answer } = beginAct(room)
    const guesser = guessers(room, actor)[0]
    room.guess(guesser, answer)

    room.disconnect(actor)
    runUntil(room, 'Reveal')

    assert.equal(room.answerId(), '', 'nobody is told an answer the actor never finished performing')
    assert.equal(room.scoreOf(guesser), 0, 'a guess made before the actor left earns nothing')
  })

  it('hands the next round to somebody who is still here', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    const actor = room.actorId()

    room.disconnect(actor)
    runUntilRound(room, 1)

    assert.notEqual(room.actorId(), actor)
    assert.ok(['0xbbb', '0xccc'].includes(room.actorId()), 'the stage went to a player in the room')
  })
})

describe('a guesser walks out', () => {
  it('does not hold the round open waiting for them', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    const { actor, answer } = beginAct(room)
    const [staying, leaving] = guessers(room, actor)

    room.disconnect(leaving)
    room.advance(2_000)
    room.guess(staying, answer)
    room.tick(0.1)

    assert.equal(room.phaseName(), 'Reveal', 'the last guesser present ends the round')
    assert.equal(room.answerId(), answer, 'and it resolves properly')
    assert.ok(room.scoreOf(staying) >= 100)
    assert.equal(room.scoreOf(leaving), 0, 'somebody who left is not scored')
  })
})

describe('a two-player room collapsing', () => {
  it('voids the round and falls back to the lobby', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'])
    const { actor } = beginAct(room)

    room.disconnect(actor)
    runUntil(room, 'Reveal')
    assert.equal(room.answerId(), '', 'the round is voided first, so the survivor is told why')

    runUntil(room, 'Lobby')
    assert.equal(room.actorId(), '', 'the lobby holds nobody on stage')
  })
})

describe('the host walks out', () => {
  it('passes the match on without losing the round or the scores', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    assert.equal(room.hostId(), '0xaaa', 'lowest userId present runs the match')

    // Round 0 first, so there are scores worth losing and the host is no longer
    // the actor. This is handover on its own, not a voided round.
    playRoundOut(room)
    runUntilRound(room, 1)
    const scoreBefore = room.scoreOf('0xbbb')
    assert.ok(scoreBefore > 0)
    assert.notEqual(room.actorId(), '0xaaa')

    room.disconnect('0xaaa')
    room.advance(1_000)

    assert.equal(room.hostId(), '0xbbb', 'the next lowest userId picked the match up')
    assert.equal(room.roundIndex(), 1, 'the round survived the handover')
    assert.equal(room.scoreOf('0xbbb'), scoreBefore, 'so did the scoreboard')
  })

  it('keeps the match advancing afterwards', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    playRoundOut(room)
    runUntilRound(room, 1)
    room.disconnect('0xaaa')
    room.advance(1_000)

    playRoundOut(room)
    assert.equal(room.phaseName(), 'Reveal')
    runUntilRound(room, 2)
    assert.equal(room.roundIndex(), 2, 'rounds keep coming under the new host')
  })
})

describe('a player coming back', () => {
  it('counts them as a guesser again', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    const { actor, answer } = beginAct(room)
    const [staying, leaving] = guessers(room, actor)

    room.disconnect(leaving)
    room.advance(2_000)
    room.guess(staying, answer)
    runUntilRound(room, 1)

    await room.join(leaving, 'Back')
    room.settle()

    const next = beginAct(room)
    const [first, second] = guessers(room, next.actor)
    room.guess(first, next.answer)
    room.tick(0.1)
    assert.equal(room.phaseName(), 'Act', 'the round waits for the player who came back')

    room.guess(second, next.answer)
    room.tick(0.1)
    assert.equal(room.phaseName(), 'Reveal', 'and ends once they answer')
  })
})

describe('a roster hiccup', () => {
  it('does not void a live round', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    // Round 1, so the actor is not also the client running the match: a host
    // cannot flicker out of its own view of the roster.
    playRoundOut(room)
    runUntilRound(room, 1)
    const { actor, answer } = beginAct(room)
    assert.notEqual(actor, room.hostId())

    room.flicker(actor)
    room.advance(1_000)
    room.restore(actor)
    room.advance(1_000)

    assert.equal(room.phaseName(), 'Act', 'a gap shorter than the grace is absorbed')

    for (const id of guessers(room, actor)) room.guess(id, answer)
    room.tick(0.1)
    assert.equal(room.answerId(), answer, 'and the round resolves normally afterwards')
  })

  it('still voids a round whose actor never comes back', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    playRoundOut(room)
    runUntilRound(room, 1)
    const { actor } = beginAct(room)

    room.flicker(actor)
    runUntil(room, 'Reveal')
    assert.equal(room.answerId(), '')
  })
})

// ---------------------------------------------------------------------------
// The long game
// ---------------------------------------------------------------------------

describe('a full match', () => {
  it('runs eight rounds and finishes on the scoreboard', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])

    for (let round = 0; round < RULES.roundsPerMatch; round++) {
      assert.equal(room.roundIndex(), round, 'round ' + round + ' is the one being played')
      playRoundOut(room)
      if (round < RULES.roundsPerMatch - 1) runUntilRound(room, round + 1)
    }

    runUntil(room, 'MatchEnd')
    assert.ok(room.scoreOf('0xaaa') > 0)
    assert.ok(room.scoreOf('0xbbb') > 0)
    assert.ok(room.scoreOf('0xccc') > 0)

    runUntil(room, 'Lobby')
    assert.deepEqual(room.scores(), [], 'the next match starts from zero')
  })

  it('gives every player the stage in turn', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    const actors: string[] = []

    for (let round = 0; round < RULES.roundsPerMatch; round++) {
      actors.push(room.actorId())
      playRoundOut(room)
      if (round < RULES.roundsPerMatch - 1) runUntilRound(room, round + 1)
    }

    assert.deepEqual(actors, ['0xaaa', '0xbbb', '0xccc', '0xaaa', '0xbbb', '0xccc', '0xaaa', '0xbbb'])
  })

  it('does not repeat an answer within a match', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    const answers: string[] = []

    for (let round = 0; round < RULES.roundsPerMatch; round++) {
      answers.push(playRoundOut(room).answer)
      if (round < RULES.roundsPerMatch - 1) runUntilRound(room, round + 1)
    }

    assert.equal(new Set(answers).size, answers.length, 'answers repeated: ' + answers.join(', '))
  })
})

// ---------------------------------------------------------------------------
// Rooms that must not brick
//
// Synced state outlives every client that wrote it, so a room can be left
// holding a match no client present is willing or able to drive. These are the
// paths that get it moving again, and the only failure class that kills a whole
// room rather than one round.
// ---------------------------------------------------------------------------

/** Mirrors `ORPHAN_GRACE_MS` in machine.ts, which is private to that module. */
const ORPHAN_GRACE_MS = 10_000
/** Mirrors `HOST_STALL_GRACE_MS`. */
const HOST_STALL_GRACE_MS = 15_000

describe('a match from another build', () => {
  it('is taken over at once when it came from an older one', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'])
    room.forceProtocol(PROTOCOL_VERSION - 1)
    room.tick(0.1)

    assert.equal(room.protocol(), PROTOCOL_VERSION, 'we understand our own payload and they do not')
    assert.equal(room.phaseName(), 'Lobby')
  })

  it('is left alone while a newer build is still driving it', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'])
    room.forceProtocol(PROTOCOL_VERSION + 1, '0xbbb')
    const tokenBefore = room.phaseToken()

    room.advance(ORPHAN_GRACE_MS + 5_000)

    assert.equal(room.protocol(), PROTOCOL_VERSION + 1, 'two builds that cannot read each other must not fight')
    assert.equal(room.phaseToken(), tokenBefore, 'and we advanced nothing of theirs')
  })

  it('is reclaimed once the newer build’s host has gone', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'])
    // A host id nobody in the room answers to: they deployed, played, and left.
    room.forceProtocol(PROTOCOL_VERSION + 1, '0xdeadbeef')

    room.advance(ORPHAN_GRACE_MS - 2_000)
    assert.equal(room.protocol(), PROTOCOL_VERSION + 1, 'not on a blip')

    room.advance(4_000)
    assert.equal(room.protocol(), PROTOCOL_VERSION, 'what they left is unplayable for everyone still here')

    // Reclaiming is only worth anything if the room then plays. It does not
    // rest in the lobby: two players are standing in it, so it starts.
    runUntilRound(room, 0)
    assert.equal(room.phaseName(), 'Pick')
  })
})

describe('a host whose scene died', () => {
  it('keeps the match while the phase could still honestly be running', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    assert.equal(room.hostId(), '0xaaa')

    room.freeze('0xaaa')
    room.advance(TIMING.pickMs + HOST_STALL_GRACE_MS - 3_000)

    assert.equal(room.hostId(), '0xaaa', 'a merely slow host must never lose the match')
  })

  it('is relieved once the phase has run well past its own length', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    room.freeze('0xaaa')

    room.advance(TIMING.pickMs + HOST_STALL_GRACE_MS + 5_000)

    assert.notEqual(room.hostId(), '0xaaa', 'the match must not be stuck behind a corpse')
  })
})

// ---------------------------------------------------------------------------
// Liveness
//
// Every other test here asks whether the machine decides correctly. These ask
// something weaker and more important: whether it decides at all. A room that
// reaches a state it cannot leave is the only failure that outlives the round
// it happened in, and the only one a player cannot fix by waiting.
//
// `phaseToken` is the honest witness — the host bumps it on every phase entry,
// so a token that stops moving is a room that has stopped.
// ---------------------------------------------------------------------------

/** Fail with the phase it died in if the match stops advancing. */
function assertStillMoving(room: Room, withinMs: number, label: string): void {
  const before = room.phaseToken()
  let spent = 0
  while (room.phaseToken() === before) {
    room.tick(0.1)
    spent += 100
    if (spent > withinMs) {
      throw new Error(`${label}: nothing advanced in ${withinMs / 1000}s — stuck in ${room.phaseName()}`)
    }
  }
}

/** Act is the longest phase, so the worst honest wait is its length plus the stall grace. */
const RECOVERY_BUDGET_MS = TIMING.actMs + HOST_STALL_GRACE_MS + 20_000

describe('a room whose host has stopped', () => {
  // Reached by name so a failure says which phase could not be escaped.
  const phases: Array<[string, (room: Room) => void]> = [
    ['Starting', () => {}],
    ['Pick', (room) => runUntil(room, 'Pick')],
    [
      'Act',
      (room) => {
        runUntil(room, 'Pick')
        beginAct(room)
      }
    ],
    [
      'Reveal',
      (room) => {
        runUntil(room, 'Pick')
        playRoundOut(room)
      }
    ],
    [
      'Intermission',
      (room) => {
        runUntil(room, 'Pick')
        playRoundOut(room)
        runUntil(room, 'Intermission')
      }
    ]
  ]

  for (const [phase, reach] of phases) {
    it(`gets going again when the host dies during ${phase}`, async () => {
      const room = createRoom()
      await room.join('0xaaa', 'Ana')
      await room.join('0xbbb', 'Bo')
      await room.join('0xccc', 'Cy')
      room.settle()
      reach(room)
      assert.equal(room.phaseName(), phase, 'the test reached the phase it meant to')
      assert.equal(room.hostId(), '0xaaa')

      // The scene dies; the avatar stays standing, so presence still counts it.
      room.freeze('0xaaa')
      assertStillMoving(room, RECOVERY_BUDGET_MS, `host died in ${phase}`)

      assert.notEqual(room.hostId(), '0xaaa', 'somebody else is driving now')
    })
  }

  it('keeps advancing for minutes, not just once', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    room.freeze('0xaaa')

    // Rounds whose actor is the frozen player void on the pick timer, which is
    // itself a form of progress. What must never happen is nothing.
    for (let pass = 0; pass < 8; pass++) {
      assertStillMoving(room, RECOVERY_BUDGET_MS, `pass ${pass}`)
    }
  })

  it('settles on one successor instead of trading the match around', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    room.freeze('0xaaa')

    const held: string[] = []
    for (let frame = 0; frame < 1_800; frame++) {
      room.tick(0.1)
      const now = room.hostId()
      if (held[held.length - 1] !== now) held.push(now)
    }

    assert.ok(held.length <= 2, `the match changed hands ${held.length - 1} times: ${held.join(' → ')}`)
  })

  it('still finishes the match under the new host', async () => {
    const room = await roomInRound(['0xaaa', 'Ana'], ['0xbbb', 'Bo'], ['0xccc', 'Cy'])
    room.freeze('0xaaa')
    assertStillMoving(room, RECOVERY_BUDGET_MS, 'handover')

    // Play out whatever is left, letting the frozen player's rounds void.
    let spent = 0
    while (room.phaseName() !== 'MatchEnd') {
      if (room.phaseName() === 'Pick' && room.actorId() !== '0xaaa') {
        const { actor, answer } = beginAct(room)
        for (const id of guessers(room, actor)) {
          if (id !== '0xaaa') room.guess(id, answer)
        }
      }
      room.tick(0.1)
      spent += 100
      assert.ok(spent < 600_000, `never reached the end — stuck in ${room.phaseName()}`)
    }

    assert.equal(room.phaseName(), 'MatchEnd', 'a match with a corpse in it still ends')
  })
})

// ---------------------------------------------------------------------------
// The solo demo — the one path a visitor arriving alone is guaranteed to hit
// ---------------------------------------------------------------------------

describe('the solo demo', () => {
  it('never offers a prompt the visitor has already mimed', async () => {
    const room = createRoom()
    const me = await room.join('0xaaa', 'Ana')
    room.settle()
    assert.equal(room.phaseName(), 'Lobby', 'the demo only runs while no match does')

    const mimed: string[] = []
    for (let again = 0; again < 6; again++) {
      me.machine.startDemo()
      const options: string[] = me.machine.demoOptionIds()
      for (const id of mimed) {
        assert.ok(!options.includes(id), 'press ' + again + ' offered ' + id + ' again')
      }

      const pick = options[0]
      me.machine.commitDemoChoice(pick)
      room.tick(0.1)
      mimed.push(pick)
      me.machine.endDemo()
    }
  })

  it('stands aside the moment a real match starts', async () => {
    const room = createRoom()
    const me = await room.join('0xaaa', 'Ana')
    room.settle()
    me.machine.startDemo()
    assert.notEqual(me.machine.demoPhaseNow(), 0)

    await room.join('0xbbb', 'Bo')
    room.settle()
    room.advance(TIMING.lobbyCountdownMs + 200)

    assert.equal(me.machine.demoPhaseNow(), 0, 'the demo is off once a match is running')
  })
})

// ---------------------------------------------------------------------------
// The harness stands in for src/index.ts. Catch it drifting.
// ---------------------------------------------------------------------------

describe('the harness frame', () => {
  it('calls what the scene calls, in the order the scene calls it', () => {
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const body = index.slice(index.indexOf('function gameSystem'))
    const order = ['refreshSelfIdentity', 'invalidateRoster', 'localTick', 'hostTick']
    const found = order.map((fn) => body.indexOf(fn + '('))

    found.forEach((at, i) => assert.notEqual(at, -1, 'gameSystem no longer calls ' + order[i]))
    assert.deepEqual(
      [...found].sort((a, b) => a - b),
      found,
      'gameSystem was reordered; test/harness/room.ts must follow'
    )
  })
})
