import { getPlayer } from '@dcl/sdk/players'
import { Match, Phase, PhaseValue, Wiggler } from './components'
import { buildRound, makeRng, PROMPTS_BY_ID } from './prompts'
import { ARENA, RULES, SCORING, TIMING, PROTOCOL_VERSION } from '../config'
import { ensureScore, parseScores, ScoreRow, serialiseScores } from './scoreboard'
import { findWiggler, getMatchEntity, getSelfEntity, isHost, myUserId, networkReady, roster } from './net'

/**
 * The match state machine.
 *
 * Only the elected host advances phases; every other client just reads `Match`
 * and renders. The two halves are `hostTick` (authority) and `localTick`
 * (this client's own clock, auto-commits and input helpers).
 */

// ---------------------------------------------------------------------------
// Host-side state (never synced — it is rebuilt from scratch on host handover)
// ---------------------------------------------------------------------------

let hostElapsedMs = 0
let hostKnownToken = -1

// ---------------------------------------------------------------------------
// Client-side state
// ---------------------------------------------------------------------------

let localElapsedMs = 0
let localKnownToken = -1
/** Set while the player is alone and messing about in the emote lab. */
let practicePromptId = ''

export function phaseDurations(phase: PhaseValue): number {
  switch (phase) {
    case Phase.Starting:
      return TIMING.lobbyCountdownMs
    case Phase.Pick:
      return TIMING.pickMs
    case Phase.Act:
      return TIMING.actMs
    case Phase.Reveal:
      return TIMING.revealMs
    case Phase.Intermission:
      return TIMING.intermissionMs
    case Phase.MatchEnd:
      return TIMING.revealMs * 2
    default:
      return 0
  }
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

export function hostTick(dtSeconds: number): void {
  if (!networkReady() || !isHost()) return

  const entity = getMatchEntity()
  if (!Match.has(entity)) {
    resetToLobby()
    return
  }

  const m = Match.get(entity)

  // The match on the wire was written by a build whose payload we may not
  // understand. Refuse to drive it rather than corrupt it — the mismatched
  // client shows an "out of date" card instead of playing.
  if (m.protocol !== PROTOCOL_VERSION) return

  // A previous host left: adopt the match and restart the current phase clock
  // rather than inheriting an unknown amount of elapsed time.
  if (m.hostId.toLowerCase() !== myUserId().toLowerCase()) {
    const mut = Match.getMutable(entity)
    mut.hostId = myUserId()
    hostElapsedMs = 0
    hostKnownToken = m.phaseToken
    return
  }

  if (hostKnownToken !== m.phaseToken) {
    hostKnownToken = m.phaseToken
    hostElapsedMs = 0
  }
  hostElapsedMs += dtSeconds * 1000

  const players = roster()

  // Not enough people for a real round — fall back to the lobby from anywhere.
  if (players.length < RULES.minPlayers && m.phase !== Phase.Lobby) {
    enterPhase(Phase.Lobby, (mut) => {
      mut.actorId = ''
      mut.optionIds = ''
      mut.answerId = ''
    })
    return
  }

  switch (m.phase as PhaseValue) {
    case Phase.Lobby:
      if (players.length >= RULES.minPlayers) enterPhase(Phase.Starting)
      return

    case Phase.Starting:
      if (timeUp(m.phaseDurationMs)) startRound(0)
      return

    case Phase.Pick: {
      const chosen = actorChoice(m.actorId, m.roundIndex)
      // The act only starts once the actor is both committed and standing on
      // the stage — a mime happening in a corner is unreadable for everyone.
      if (chosen !== '' && isOnStage(m.actorId)) {
        enterPhase(Phase.Act)
      } else if (timeUp(m.phaseDurationMs)) {
        // Actor never committed, or never walked on (usually because they
        // dropped). Void the round instead of stalling everyone.
        voidRound()
      }
      return
    }

    case Phase.Act:
      if (timeUp(m.phaseDurationMs) || everyoneGuessed(m.actorId, m.roundIndex)) resolveRound()
      return

    case Phase.Reveal:
      if (timeUp(m.phaseDurationMs)) enterPhase(Phase.Intermission)
      return

    case Phase.Intermission:
      if (!timeUp(m.phaseDurationMs)) return
      if (m.roundIndex + 1 >= RULES.roundsPerMatch) enterPhase(Phase.MatchEnd)
      else startRound(m.roundIndex + 1)
      return

    case Phase.MatchEnd:
      if (timeUp(m.phaseDurationMs)) resetToLobby()
      return
  }
}

function timeUp(durationMs: number): boolean {
  return hostElapsedMs >= durationMs
}

function resetToLobby(): void {
  const entity = getMatchEntity()
  Match.createOrReplace(entity, {
    protocol: PROTOCOL_VERSION,
    hostId: myUserId(),
    phase: Phase.Lobby,
    roundIndex: -1,
    actorId: '',
    optionIds: '',
    answerId: '',
    phaseDurationMs: 0,
    phaseToken: (Match.getOrNull(entity)?.phaseToken ?? 0) + 1,
    scores: '',
    usedPromptIds: ''
  })
  hostElapsedMs = 0
  hostKnownToken = Match.get(entity).phaseToken
}

/** Enter `phase`, bumping the token so clients restart their countdown. */
function enterPhase(phase: PhaseValue, patch?: (mut: ReturnType<typeof Match.getMutable>) => void): void {
  const mut = Match.getMutable(getMatchEntity())
  mut.phase = phase
  mut.phaseDurationMs = phaseDurations(phase)
  mut.phaseToken = mut.phaseToken + 1
  if (patch) patch(mut)
  hostElapsedMs = 0
  hostKnownToken = mut.phaseToken
}

function startRound(roundIndex: number): void {
  const entity = getMatchEntity()
  const m = Match.get(entity)

  const actor = nextActor(m.actorId)
  if (actor === null) {
    enterPhase(Phase.Lobby)
    return
  }

  const used = m.usedPromptIds === '' ? [] : m.usedPromptIds.split(',')
  // Seeded so the option set is reproducible when debugging a specific round.
  const rng = makeRng(roundIndex * 7919 + m.phaseToken * 104729 + 1)
  const round = buildRound(rng, used)

  const nextUsed = used.concat(round.optionIds).slice(-RULES.recentPromptMemory)

  enterPhase(Phase.Pick, (mut) => {
    mut.roundIndex = roundIndex
    mut.actorId = actor.userId
    mut.optionIds = round.optionIds.join(',')
    mut.answerId = ''
    mut.usedPromptIds = nextUsed.join(',')
  })
}

/** Next player in the userId-sorted ring after `prevActorId`. */
function nextActor(prevActorId: string): { userId: string } | null {
  const list = roster()
  if (list.length === 0) return null
  const prev = prevActorId.toLowerCase()
  let idx = -1
  for (let i = 0; i < list.length; i++) {
    if (list[i].userId.toLowerCase() === prev) {
      idx = i
      break
    }
  }
  return list[(idx + 1) % list.length]
}

function actorChoice(actorId: string, roundIndex: number): string {
  const actor = findWiggler(actorId)
  if (actor === null) return ''
  const w = Wiggler.getOrNull(actor.entity)
  if (w === null || w.roundIndex !== roundIndex) return ''
  return w.choiceId
}

function everyoneGuessed(actorId: string, roundIndex: number): boolean {
  const actor = actorId.toLowerCase()
  let guessers = 0
  let answered = 0
  for (const p of roster()) {
    if (p.userId.toLowerCase() === actor) continue
    guessers++
    const w = Wiggler.getOrNull(p.entity)
    if (w !== null && w.roundIndex === roundIndex && w.guessId !== '') answered++
  }
  return guessers > 0 && answered === guessers
}

/**
 * End the round with nothing to reveal. It still passes *through* Reveal so
 * players are told why the round died, instead of being dropped into an
 * unexplained intermission.
 */
function voidRound(): void {
  const rows = parseScores(Match.get(getMatchEntity()).scores)
  for (const r of rows) r.lastGained = 0

  enterPhase(Phase.Reveal, (mut) => {
    mut.answerId = ''
    mut.scores = serialiseScores(rows)
  })
}

function resolveRound(): void {
  const entity = getMatchEntity()
  const m = Match.get(entity)
  const answerId = actorChoice(m.actorId, m.roundIndex)

  const rows = parseScores(m.scores)
  for (const r of rows) r.lastGained = 0

  let correctCount = 0

  if (answerId !== '') {
    const actorKey = m.actorId.toLowerCase()
    for (const p of roster()) {
      if (p.userId.toLowerCase() === actorKey) continue
      const w = Wiggler.getOrNull(p.entity)
      const row = ensureScore(rows, p.userId)
      const guessed = w !== null && w.roundIndex === m.roundIndex ? w.guessId : ''

      if (guessed === answerId) {
        correctCount++
        row.streak = row.streak + 1
        row.lastGained = Math.round(SCORING.correctGuess * streakMultiplier(row.streak) + speedBonus(w!.guessMs))
        row.score += row.lastGained
      } else {
        row.streak = 0
      }
    }

    const actorRow = ensureScore(rows, m.actorId)
    actorRow.lastGained = Math.max(SCORING.actorFloor, correctCount * SCORING.actorPerCorrectGuess)
    actorRow.score += actorRow.lastGained
  }

  enterPhase(Phase.Reveal, (mut) => {
    mut.answerId = answerId
    mut.scores = serialiseScores(rows)
  })
}

function streakMultiplier(streak: number): number {
  const table = SCORING.streakMultipliers
  return table[Math.min(Math.max(streak, 1) - 1, table.length - 1)]
}

function speedBonus(guessMs: number): number {
  const remaining = 1 - guessMs / TIMING.actMs
  return SCORING.maxSpeedBonus * Math.max(0, Math.min(1, remaining))
}

// ---------------------------------------------------------------------------
// Local client
// ---------------------------------------------------------------------------

export function localTick(dtSeconds: number): void {
  const entity = getMatchEntity()
  const m = Match.getOrNull(entity)
  if (m === null || !protocolOk()) return

  if (localKnownToken !== m.phaseToken) {
    localKnownToken = m.phaseToken
    localElapsedMs = 0
  }
  localElapsedMs += dtSeconds * 1000

  // Practice is a lobby-only distraction. Once a real match starts it has to go
  // immediately: the practice sheet covers the pick and guess UI, so a player
  // left inside it would silently sit out — or, if they are the actor, mime a
  // prompt they never saw.
  if (practicePromptId !== '' && m.phase !== Phase.Lobby) endPractice()

  // The actor's own client commits a random option if they sat out the pick
  // timer, so an idle-but-connected actor does not void the round.
  if (m.phase === Phase.Pick && amActor() && localElapsedMs > TIMING.pickMs - 600 && myChoice(m.roundIndex) === '') {
    const options = optionIds()
    if (options.length > 0) commitChoice(options[Math.floor(Math.random() * options.length)])
  }
}

/** Milliseconds since this client observed the current phase begin. */
export function phaseElapsedMs(): number {
  return localElapsedMs
}

/** 0..1 of the current phase remaining, for the countdown bar. */
export function phaseRemaining01(): number {
  const m = Match.getOrNull(getMatchEntity())
  if (m === null || m.phaseDurationMs <= 0) return 0
  return Math.max(0, Math.min(1, 1 - localElapsedMs / m.phaseDurationMs))
}

export function secondsLeft(): number {
  const m = Match.getOrNull(getMatchEntity())
  if (m === null || m.phaseDurationMs <= 0) return 0
  return Math.max(0, Math.ceil((m.phaseDurationMs - localElapsedMs) / 1000))
}

export function currentMatch() {
  return Match.getOrNull(getMatchEntity())
}

/** False when the live match was written by a build we do not understand. */
export function protocolOk(): boolean {
  const m = currentMatch()
  return m === null || m.protocol === PROTOCOL_VERSION
}

/**
 * Is `userId` standing on the stage disc? XZ only — jumping is still acting.
 *
 * Returns `true` when the position is unknown. A missing avatar transform must
 * never be able to stall a round, so the check fails open.
 */
export function isOnStage(userId: string): boolean {
  if (userId === '') return true
  const pos = getPlayer({ userId })?.position
  if (!pos) return true

  const dx = pos.x - ARENA.stage.x
  const dz = pos.z - ARENA.stage.z
  return dx * dx + dz * dz <= ARENA.stageRadius * ARENA.stageRadius
}

export function optionIds(): string[] {
  const m = currentMatch()
  if (m === null || m.optionIds === '') return []
  return m.optionIds.split(',').filter((id) => PROMPTS_BY_ID[id] !== undefined)
}

export function amActor(): boolean {
  const m = currentMatch()
  const me = myUserId()
  return m !== null && me !== '' && m.actorId.toLowerCase() === me.toLowerCase()
}

export function myChoice(roundIndex: number): string {
  const w = Wiggler.getOrNull(getSelfEntity())
  if (w === null || w.roundIndex !== roundIndex) return ''
  return w.choiceId
}

export function myGuess(roundIndex: number): string {
  const w = Wiggler.getOrNull(getSelfEntity())
  if (w === null || w.roundIndex !== roundIndex) return ''
  return w.guessId
}

/** Actor locks the prompt they are going to mime. */
export function commitChoice(promptId: string): void {
  const m = currentMatch()
  if (m === null || !protocolOk() || m.phase !== Phase.Pick || !amActor()) return
  if (optionIds().indexOf(promptId) === -1) return

  const w = Wiggler.getMutable(getSelfEntity())
  w.roundIndex = m.roundIndex
  w.choiceId = promptId
  w.guessId = ''
  w.guessMs = 0
}

/** Guesser locks an answer. First answer stands — no take-backs. */
export function commitGuess(promptId: string): void {
  const m = currentMatch()
  if (m === null || !protocolOk() || m.phase !== Phase.Act || amActor()) return
  if (optionIds().indexOf(promptId) === -1) return
  if (myGuess(m.roundIndex) !== '') return

  const w = Wiggler.getMutable(getSelfEntity())
  w.roundIndex = m.roundIndex
  w.choiceId = ''
  w.guessId = promptId
  w.guessMs = Math.round(localElapsedMs)
}

// ---------------------------------------------------------------------------
// Solo practice — keeps a single visitor busy instead of showing a dead lobby
// ---------------------------------------------------------------------------

export function practicePrompt(): string {
  return practicePromptId
}

export function rollPracticePrompt(): void {
  const rng = makeRng(Math.floor(Math.random() * 0xffffffff))
  practicePromptId = buildRound(rng).answerId
}

export function endPractice(): void {
  practicePromptId = ''
}

export function scoreRows(): ScoreRow[] {
  const m = currentMatch()
  return m === null ? [] : parseScores(m.scores)
}

/**
 * Returns the number of guessers who picked each option in the given round.
 * Includes only players who are still in the roster (present in the scene).
 */
export function getVotesForRound(actorId: string, roundIndex: number): Record<string, number> {
  const votes: Record<string, number> = {}
  const actorLow = actorId.toLowerCase()
  for (const p of roster()) {
    if (p.userId.toLowerCase() === actorLow) continue
    const w = Wiggler.getOrNull(p.entity)
    if (w !== null && w.roundIndex === roundIndex && w.guessId !== '') {
      votes[w.guessId] = (votes[w.guessId] ?? 0) + 1
    }
  }
  return votes
}
