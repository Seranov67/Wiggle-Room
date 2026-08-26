/** All the numbers you will want to tune during playtests, in one place. */

export const TIMING = {
  /** Actor picks which of the 4 prompts to mime. */
  pickMs: 12_000,
  /** The performance. Guessers may lock an answer at any point during it. */
  actMs: 45_000,
  /** Answer + points breakdown on screen. */
  revealMs: 9_000,
  /** Breather between rounds; also when a new actor is chosen. */
  intermissionMs: 4_000,
  /** How long the lobby waits once there are enough players. */
  lobbyCountdownMs: 8_000
} as const

/**
 * The solo demo runs on a shorter clock than a real round. Someone who just
 * walked in alone is deciding whether this game is worth waiting for — make
 * them sit through 45 seconds of acting to nobody and they will leave.
 */
export const DEMO = {
  pickMs: 15_000,
  actMs: 20_000,
  revealMs: 12_000
} as const

export const SCORING = {
  correctGuess: 100,
  /** Extra points for guessing early, decaying linearly to 0 at the end of the act phase. */
  maxSpeedBonus: 100,
  /** The actor earns this for every player who guessed right — expressiveness pays. */
  actorPerCorrectGuess: 60,
  /** Consolation so a nobody-got-it round is not a total loss for the actor. */
  actorFloor: 10,
  /** Multiplier steps for consecutive correct guesses: 1st, 2nd, 3rd+. */
  streakMultipliers: [1, 1.25, 1.5]
} as const

/**
 * The audience's own emotes during a performance.
 *
 * Reactions ride the platform's avatar channel, not our synced components, so
 * they cost no `PROTOCOL_VERSION` — but a mashed button restarts the animation
 * every frame, which reads as a twitch rather than a reaction and makes a busy
 * room strobe. Hence a gate roughly the length of a short emote.
 */
export const REACTIONS = {
  cooldownMs: 1_200
} as const

export const RULES = {
  /** Below this the scene stays in the lobby, where a lone visitor can run the solo demo. */
  minPlayers: 2,
  /** Rounds in a match before the season scoreboard is shown and scores reset. */
  roundsPerMatch: 8,
  /** Prompts that cannot come up again within a match. */
  recentPromptMemory: 12
} as const

export const ARENA = {
  /** Centre of the parcel; the actor's stage. */
  stage: { x: 8, y: 0, z: 8 },
  stageRadius: 3.2,
  /** Where the audience ring sits. */
  ringRadius: 6.5
} as const

/** Bump when the network payload shape changes so old clients bail out loudly. */
export const PROTOCOL_VERSION = 1
