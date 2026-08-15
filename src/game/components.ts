import { engine, Schemas } from '@dcl/sdk/ecs'

/**
 * Phases of one round. Numeric so the value survives the CRDT wire format
 * unambiguously and so comparisons stay cheap in systems.
 */
export const Phase = {
  /** Not enough players. */
  Lobby: 0,
  /** Enough players joined; short countdown before round 1. */
  Starting: 1,
  /** The actor is choosing which of the 4 prompts to mime. */
  Pick: 2,
  /** The performance. Guessers can lock an answer. */
  Act: 3,
  /** Answer and points on screen. */
  Reveal: 4,
  /** Breather; the next actor is already known. */
  Intermission: 5,
  /** Match over, final scoreboard. */
  MatchEnd: 6
} as const

export type PhaseValue = (typeof Phase)[keyof typeof Phase]

/**
 * The single source of truth for the match, written **only by the elected
 * host**. Every other client treats it as read-only.
 *
 * Scores live here rather than on each player so that exactly one client ever
 * writes them — no last-write-wins races between the host's scoring pass and a
 * player's own updates.
 */
export const Match = engine.defineComponent('wiggle::Match', {
  protocol: Schemas.Int,
  /** userId of the client currently running the state machine. */
  hostId: Schemas.String,
  phase: Schemas.Int,
  /** 0-based; also a change token so clients can detect a new round. */
  roundIndex: Schemas.Int,
  /** userId of the actor for this round. */
  actorId: Schemas.String,
  /** The 4 prompt ids offered this round, comma separated, in display order. */
  optionIds: Schemas.String,
  /** Revealed at Phase.Reveal; empty string before that. */
  answerId: Schemas.String,
  /** How long the current phase lasts, for the countdown bar. */
  phaseDurationMs: Schemas.Int,
  /** Bumped on every phase entry. Clients restart their local countdown when
   *  it changes, so no clock synchronisation is needed. */
  phaseToken: Schemas.Int,
  /** Serialised scoreboard — see `scoreboard.ts`. Host-owned. */
  scores: Schemas.String,
  /** Prompt ids already used this match, comma separated, so they do not repeat. */
  usedPromptIds: Schemas.String
})

/**
 * One per connected player, created and written **only by that player's own
 * client**, then synced. The host reads them to resolve the round.
 *
 * Note on `choiceId`: the actor's prompt lives here from the moment they pick,
 * so a modified client could read it early. Accepted trade-off — it keeps the
 * reveal working even if the actor drops mid-round, and this is a party game.
 */
export const Wiggler = engine.defineComponent('wiggle::Wiggler', {
  userId: Schemas.String,
  name: Schemas.String,
  /** Which round the fields below refer to. Stale values are ignored. */
  roundIndex: Schemas.Int,
  /** Set by the actor only: the prompt they committed to mime. */
  choiceId: Schemas.String,
  /** Set by guessers: the option they locked in. */
  guessId: Schemas.String,
  /** Milliseconds into the act phase when the guess was locked, for the speed bonus. */
  guessMs: Schemas.Int
})

/** Stable network id for the singleton match entity (identical on every client). */
export const SyncId = {
  Match: 1000
} as const
