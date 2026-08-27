import { getPlayer } from '@dcl/sdk/players'
import { Match, Phase, Wiggler } from './components'
import type { PhaseValue } from './components'
import { buildRound, makeRng, packForDay, PROMPTS_BY_ID } from './prompts'
import { ARENA, DEMO, RULES, SCORING, TIMING, PROTOCOL_VERSION } from '../config'
import { ensureScore, parseScores, serialiseScores } from './scoreboard'
import type { ScoreRow } from './scoreboard'
import { speedBonus, streakMultiplier } from './scoring'
import {
  findWiggler,
  getMatchEntity,
  getSelfEntity,
  isElectedExcluding,
  isHost,
  isPresent,
  myUserId,
  networkReady,
  roster
} from './net'

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
/** How long the round's actor has been missing from the roster. */
let actorGoneMs = 0
/** How long the roster has been too thin to sustain a round. */
let rosterThinMs = 0
/** How long a match from a newer build has been without its host in the room. */
let orphanedMatchMs = 0
/** How long we have been standing aside for a host who is here but not advancing. */
let deferredToHostMs = 0
let deferredToHostToken = -1

/**
 * A hole in the roster — a missing actor, or a room that just dropped below
 * `minPlayers` — has to persist this long before we act on it. Absorbs the
 * brief gaps a sync hiccup produces, without making anyone wait around.
 */
const ROSTER_GRACE_MS = 1_500

/** How long a newer build's match must be hostless before we take it over. */
const ORPHAN_GRACE_MS = 10_000

/**
 * How far past the end of a phase a present-but-silent host may go before
 * someone else takes the match off them. Generous on purpose: a host who is
 * merely slow should never lose the match, only one that has plainly stopped.
 */
const HOST_STALL_GRACE_MS = 15_000

// ---------------------------------------------------------------------------
// Client-side state
// ---------------------------------------------------------------------------

let localElapsedMs = 0
let localKnownToken = -1

/** Solo demo state. Never synced — it exists only for whoever is running it. */
let demoPhase: DemoPhaseValue = 0
let demoElapsedMs = 0
let demoOptions: string[] = []
let demoChoiceId = ''
/** Answers this visitor has already been shown, so "Again" is actually again. */
let demoUsed: string[] = []

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
  if (!networkReady()) return

  const entity = getMatchEntity()
  if (!Match.has(entity)) {
    if (isHost()) resetToLobby()
    return
  }

  const m = Match.get(entity)

  // Protocol reconciliation runs *before* the host election on purpose: when
  // the elected host is the incompatible one, gating this behind `isHost()`
  // would deadlock the room — it cannot drive the match and nobody else is
  // allowed to.
  if (m.protocol !== PROTOCOL_VERSION) {
    reconcileProtocol(m.protocol, m.hostId, dtSeconds)
    return
  }
  orphanedMatchMs = 0

  // Whoever the match says is driving it keeps driving it. The election only
  // decides who *claims* a match nobody is running — it does not outrank a host
  // that is alive and working, and treating it as though it did is how two
  // clients end up trading the match back and forth.
  if (m.hostId === '' || m.hostId.toLowerCase() !== myUserId().toLowerCase()) {
    if (!takeOverFrom(m.hostId, m.phaseToken, m.phaseDurationMs, dtSeconds)) return
    // Elect the successor without the outgoing host on the ballot. When they
    // have left the room this is exactly `isHost()`, because they are not in
    // the roster to be skipped; when their scene died behind a still-standing
    // avatar it is the difference between handing the match on and never being
    // able to, since presence alone would keep electing the corpse.
    if (!isElectedExcluding(m.hostId)) return

    // Adopt, and restart the current phase clock rather than inheriting an
    // unknown amount of elapsed time.
    //
    // The token bump is what makes that honest. Without it the new host starts
    // the phase over while every client keeps its old countdown, so the bar
    // hits zero and then nothing happens for up to a full phase. Bumping it
    // restarts everyone's clock together: the phase visibly begins again,
    // which is the truth, instead of silently hanging.
    const mut = Match.getMutable(entity)
    mut.hostId = myUserId()
    mut.phaseToken = mut.phaseToken + 1
    hostElapsedMs = 0
    actorGoneMs = 0
    hostKnownToken = mut.phaseToken
    return
  }
  deferredToHostMs = 0
  deferredToHostToken = -1

  if (hostKnownToken !== m.phaseToken) {
    hostKnownToken = m.phaseToken
    hostElapsedMs = 0
    actorGoneMs = 0
  }
  hostElapsedMs += dtSeconds * 1000

  const players = roster()

  if (players.length >= RULES.minPlayers) rosterThinMs = 0
  else rosterThinMs += dtSeconds * 1000

  // Not enough people for a real round. This is the two-player case: the actor
  // leaves, the roster collapses, and the one person left is standing in an
  // arena wondering what happened. So unwind it in the same order a full room
  // would — void the round, show why, *then* fall back to the lobby.
  //
  // Grace-gated like the actor check: a two-player round must not die because
  // one player flickered out of the roster for a frame.
  if (rosterThinMs >= ROSTER_GRACE_MS && m.phase !== Phase.Lobby) {
    if (m.phase === Phase.Pick || m.phase === Phase.Act) {
      voidRound()
      return
    }
    // Let a result that is already on screen finish being read.
    if ((m.phase === Phase.Reveal || m.phase === Phase.MatchEnd) && !timeUp(m.phaseDurationMs)) return

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
      // Actor walked out. End it now rather than running the full timer down.
      if (!actorPresent(m.actorId, dtSeconds)) {
        voidRound()
        return
      }

      const chosen = actorChoice(m.actorId, m.roundIndex)
      // Standing on the stage holds the act back while the pick timer runs — a
      // mime happening in a corner is unreadable — but it is a nudge, not a
      // hard gate: see the timeout branch below.
      if (chosen !== '' && isOnStage(m.actorId)) {
        enterPhase(Phase.Act)
      } else if (timeUp(m.phaseDurationMs)) {
        // Timer's up. An actor who committed still gets their act even if they
        // never made it onto the stage: the position read comes from the
        // renderer and we would rather run an off-centre round than void a
        // good one on data we cannot fully trust. Only a silent actor voids.
        if (chosen !== '') enterPhase(Phase.Act)
        else voidRound()
      }
      return
    }

    case Phase.Act:
      // Nobody should watch an empty stage for the rest of a 45s timer.
      if (!actorPresent(m.actorId, dtSeconds)) {
        voidRound()
        return
      }
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

/**
 * Decide what to do about a match written by a different build of the scene.
 *
 * Standing down unconditionally would brick the room: synced state outlives the
 * client that wrote it, so a single visitor on a newer build can leave behind a
 * match that no remaining client is willing to touch — and reloading does not
 * clear it, because the stale state syncs straight back from the other peers.
 *
 * Liveness is judged by whether the match's own host is still in the room —
 * never by whether the match is advancing. Lobby is a legitimate resting state
 * that never bumps `phaseToken`, so a frozen token proves nothing, and treating
 * it as death would let an old client stomp a perfectly healthy newer host.
 */
function reconcileProtocol(theirProtocol: number, theirHostId: string, dtSeconds: number): void {
  // We are the newer build: we understand our own payload and they do not.
  if (theirProtocol < PROTOCOL_VERSION) {
    resetToLobby()
    return
  }

  // They are newer and their host is still here, so the room is genuinely
  // mixed. Stand down and keep showing the "out of date" card: two builds that
  // cannot read each other's payload have no correct way to share a room, and
  // pretending otherwise would just make the two of us fight over the state.
  if (isPresent(theirHostId)) {
    orphanedMatchMs = 0
    return
  }

  // Their host is gone and what they left behind is unplayable for everyone
  // still standing here. Take it over, once we are sure this is not a blip.
  orphanedMatchMs += dtSeconds * 1000
  if (orphanedMatchMs >= ORPHAN_GRACE_MS) resetToLobby()
}

/**
 * May we take the match away from `hostId`?
 *
 * Yes once they have left the room. Yes, eventually, if they are still here but
 * the phase has run well past its own duration — a client whose scene died
 * leaves an avatar behind, and the match must not be stuck behind a corpse.
 *
 * No while they are here and the phase is still running to time. Two clients
 * can both believe they are elected for a moment, each seeing a roster the
 * other has not synced into yet, and since adopting bumps `phaseToken` that
 * disagreement would reset everybody's countdown every frame — a worse fault
 * than the frozen timer the bump was added to cure. The window closes as soon
 * as the rosters agree, and only the elected client ever adopts, so this can
 * never settle into two clients trading the match.
 */
function takeOverFrom(hostId: string, token: number, phaseDurationMs: number, dtSeconds: number): boolean {
  if (!isPresent(hostId)) {
    deferredToHostMs = 0
    deferredToHostToken = -1
    return true
  }

  if (deferredToHostToken !== token) {
    deferredToHostToken = token
    deferredToHostMs = 0
  }
  deferredToHostMs += dtSeconds * 1000

  // The lobby has no duration of its own, so it gets the flat grace rather than
  // being exempt. Handover there costs nothing — nothing is counting down — and
  // exempting it would mean a host whose scene died while their avatar stayed
  // put could keep the room from ever starting a match.
  return deferredToHostMs > Math.max(0, phaseDurationMs) + HOST_STALL_GRACE_MS
}

/**
 * Is the round's actor still here? Answers `true` during the grace window so a
 * momentary roster gap cannot void a live round.
 */
function actorPresent(actorId: string, dtSeconds: number): boolean {
  if (findWiggler(actorId) !== null) {
    actorGoneMs = 0
    return true
  }
  actorGoneMs += dtSeconds * 1000
  return actorGoneMs < ROSTER_GRACE_MS
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
  actorGoneMs = 0
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
  actorGoneMs = 0
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
  const round = buildRound(rng, used, packForDay())

  // Nothing is spent here. `buildRound` nominates an answer, but the actor is
  // free to mime any of the four, so the prompt this round actually uses is not
  // known until they commit — see `resolveRound`. Spending the nominee instead
  // burned a prompt nobody performed and left the performed one free to come
  // back: three rounds running on the same prompt, in an eight-round match.
  enterPhase(Phase.Pick, (mut) => {
    mut.roundIndex = roundIndex
    mut.actorId = actor.userId
    mut.optionIds = round.optionIds.join(',')
    mut.answerId = ''
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
        row.lastGained = Math.round(
          SCORING.correctGuess * streakMultiplier(row.streak, SCORING.streakMultipliers) +
            speedBonus(w!.guessMs, TIMING.actMs, SCORING.maxSpeedBonus)
        )
        row.score += row.lastGained
      } else {
        row.streak = 0
      }
    }

    const actorRow = ensureScore(rows, m.actorId)
    actorRow.lastGained = Math.max(SCORING.actorFloor, correctCount * SCORING.actorPerCorrectGuess)
    actorRow.score += actorRow.lastGained
  }

  // A round spends the prompt it actually played, and only once it is known.
  // One per round, exactly as before — barring the decoys as well would burn
  // through the featured pack four times faster than necessary, and the day's
  // theme would quietly stop being the day's theme around round three.
  const used = m.usedPromptIds === '' ? [] : m.usedPromptIds.split(',')
  const nextUsed = answerId === '' ? used : used.concat(answerId).slice(-RULES.recentPromptMemory)

  enterPhase(Phase.Reveal, (mut) => {
    mut.answerId = answerId
    mut.scores = serialiseScores(rows)
    mut.usedPromptIds = nextUsed.join(',')
  })
}

// ---------------------------------------------------------------------------
// Local client
// ---------------------------------------------------------------------------

export function localTick(dtSeconds: number): void {
  demoTick(dtSeconds)

  const entity = getMatchEntity()
  const m = Match.getOrNull(entity)
  if (m === null || !protocolOk()) return

  if (localKnownToken !== m.phaseToken) {
    localKnownToken = m.phaseToken
    localElapsedMs = 0
  }
  localElapsedMs += dtSeconds * 1000

  // The actor's own client commits a random option if they sat out the pick
  // timer, so an idle-but-connected actor does not void the round.
  if (m.phase === Phase.Pick && amActor() && localElapsedMs > TIMING.pickMs - 600 && myChoice(m.roundIndex) === '') {
    const options = optionIds()
    if (options.length > 0) commitChoice(options[Math.floor(Math.random() * options.length)])
  }
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
// Solo demo — the whole round, played alone
//
// Someone who arrives before anyone else would otherwise be shown a lobby that
// says "1 more player to start", and nothing else. That is a dreadful first
// impression of a game whose entire point *is* the round — and it is exactly
// what a reviewer visiting on their own would see.
//
// So a lone visitor can play one through: pick a prompt, mime it on the stage,
// then read what would have happened. It runs entirely on this client and never
// writes to the synced `Match`, so it cannot disturb a real match forming
// around it — and it steps aside the moment one does.
// ---------------------------------------------------------------------------

export const DemoPhase = { Off: 0, Pick: 1, Act: 2, Reveal: 3 } as const
export type DemoPhaseValue = (typeof DemoPhase)[keyof typeof DemoPhase]

function demoDuration(phase: DemoPhaseValue): number {
  switch (phase) {
    case DemoPhase.Pick:
      return DEMO.pickMs
    case DemoPhase.Act:
      return DEMO.actMs
    case DemoPhase.Reveal:
      return DEMO.revealMs
    default:
      return 0
  }
}

function demoTick(dtSeconds: number): void {
  if (demoPhase === DemoPhase.Off) return

  // A real match started. The demo has done its job — get out of the way.
  const m = Match.getOrNull(getMatchEntity())
  if (m !== null && m.phase !== Phase.Lobby) {
    endDemo()
    return
  }

  demoElapsedMs += dtSeconds * 1000

  switch (demoPhase) {
    case DemoPhase.Pick: {
      // Committing early skips the wait; running the clock out picks for them,
      // because a demo that stalls teaches the wrong thing about the game.
      const timedOut = demoElapsedMs >= DEMO.pickMs
      if (demoChoiceId === '' && timedOut) {
        demoChoiceId = demoOptions[Math.floor(Math.random() * demoOptions.length)] ?? ''
      }
      if (demoChoiceId === '' && !timedOut) return

      // Spend what they mimed, not what `buildRound` nominated — the same rule
      // `resolveRound` follows, and the reason it matters here is "Again":
      // the visitor picks one of four, so recording the nominee left the prompt
      // they just performed free to come straight back.
      if (demoChoiceId !== '') demoUsed = demoUsed.concat(demoChoiceId).slice(-RULES.recentPromptMemory)
      enterDemoPhase(DemoPhase.Act)
      return
    }

    case DemoPhase.Act:
      if (demoElapsedMs >= DEMO.actMs) enterDemoPhase(DemoPhase.Reveal)
      return

    case DemoPhase.Reveal:
      if (demoElapsedMs >= DEMO.revealMs) endDemo()
      return
  }
}

function enterDemoPhase(phase: DemoPhaseValue): void {
  demoPhase = phase
  demoElapsedMs = 0
}

export function startDemo(): void {
  // The lobby advertises today's theme two lines above the button that starts
  // this round, so the round had better be on it. And "Again" has to mean a
  // different prompt — a solo visitor pressing it twice and getting the same
  // one learns that the library is small, which is the opposite of the point.
  const round = buildRound(makeRng(Math.floor(Math.random() * 0xffffffff)), demoUsed, packForDay())
  demoOptions = round.optionIds
  demoChoiceId = ''
  enterDemoPhase(DemoPhase.Pick)
}

export function endDemo(): void {
  demoPhase = DemoPhase.Off
  demoElapsedMs = 0
  demoOptions = []
  demoChoiceId = ''
}

export function demoPhaseNow(): DemoPhaseValue {
  return demoPhase
}

export function demoOptionIds(): string[] {
  return demoOptions
}

export function demoChoice(): string {
  return demoChoiceId
}

/** The actor's own pick is what they mime, so in a demo it is also the answer. */
export function commitDemoChoice(promptId: string): void {
  if (demoPhase !== DemoPhase.Pick) return
  if (demoOptions.indexOf(promptId) === -1) return
  demoChoiceId = promptId
}

export function demoSecondsLeft(): number {
  const total = demoDuration(demoPhase)
  return total <= 0 ? 0 : Math.max(0, Math.ceil((total - demoElapsedMs) / 1000))
}

export function demoRemaining01(): number {
  const total = demoDuration(demoPhase)
  return total <= 0 ? 0 : Math.max(0, Math.min(1, 1 - demoElapsedMs / total))
}

export function scoreRows(): ScoreRow[] {
  const m = currentMatch()
  return m === null ? [] : parseScores(m.scores)
}

/**
 * Returns the number of guessers who picked each option in the given round.
 * Includes only players who are still in the roster (present in the scene).
 */
/**
 * The userIds of everyone who read the actor correctly this round.
 *
 * The reveal knows the counts already, but a count is a number and a name is
 * an event — "donyyden read you" lands where "2" does not.
 */
export function readersOf(actorId: string, roundIndex: number, answerId: string): string[] {
  if (answerId === '') return []
  const actorLow = actorId.toLowerCase()
  const out: string[] = []
  for (const p of roster()) {
    if (p.userId.toLowerCase() === actorLow) continue
    const w = Wiggler.getOrNull(p.entity)
    if (w !== null && w.roundIndex === roundIndex && w.guessId === answerId) out.push(p.userId)
  }
  return out
}

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
