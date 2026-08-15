/**
 * Prompt library for Wiggle Room.
 *
 * A round shows the actor one prompt and shows every guesser 4 options:
 * the real prompt + 3 decoys drawn from the SAME pack. Same-pack decoys are
 * what makes a round hard — random decoys are too easy to eliminate.
 *
 * Rule for adding prompts: it has to be actable with the built-in emote set
 * plus walking/jumping. If you cannot mime it in 3 emotes, it does not belong.
 */

export type PackId = 'everyday' | 'party' | 'internet' | 'movies'

export type Prompt = {
  /** Stable id — used in network messages and in the leaderboard, never renamed. */
  id: string
  pack: PackId
  /** Shown to the actor, and as one of the 4 buttons for guessers. Keep under ~28 chars. */
  text: string
  /** Emote ids that read well for this prompt. Highlighted in the wheel while acting. */
  suggests: string[]
}

export const PACK_NAMES: Record<PackId, string> = {
  everyday: 'Everyday Pain',
  party: 'Party Mode',
  internet: 'Extremely Online',
  movies: 'Screen Time'
}

const PACK_ORDER: PackId[] = ['everyday', 'party', 'internet', 'movies']

/**
 * Which pack is in the spotlight, `dayOffset` days from now.
 *
 * Keyed to the UTC day number, so every player on Earth gets the same theme
 * without a server, a database, or one byte of stored state — and so tomorrow
 * is reliably different from today. That difference is the whole reason to come
 * back, and it costs nothing to run.
 */
export function packForDay(dayOffset = 0, nowMs: number = Date.now()): PackId {
  const day = Math.floor(nowMs / 86_400_000) + dayOffset
  const index = ((day % PACK_ORDER.length) + PACK_ORDER.length) % PACK_ORDER.length
  return PACK_ORDER[index]
}

export const PROMPTS: Prompt[] = [
  // ---- everyday ----------------------------------------------------------
  { id: 'ev-monday', pack: 'everyday', text: 'Monday morning', suggests: ['headexplode', 'shrug'] },
  { id: 'ev-lottery', pack: 'everyday', text: 'Winning the lottery', suggests: ['money', 'fistpump', 'disco'] },
  { id: 'ev-rent', pack: 'everyday', text: 'Rent is due', suggests: ['money', 'dontsee', 'shrug'] },
  { id: 'ev-lost', pack: 'everyday', text: 'Completely lost', suggests: ['shrug', 'raiseHand'] },
  { id: 'ev-latebus', pack: 'everyday', text: 'Missing the last bus', suggests: ['raiseHand', 'headexplode'] },
  { id: 'ev-firstdate', pack: 'everyday', text: 'A very bad first date', suggests: ['kiss', 'dontsee', 'shrug'] },
  { id: 'ev-coffee', pack: 'everyday', text: 'Out of coffee', suggests: ['headexplode', 'dontsee'] },
  { id: 'ev-raise', pack: 'everyday', text: 'Asking for a raise', suggests: ['raiseHand', 'money', 'shrug'] },
  { id: 'ev-assembly', pack: 'everyday', text: 'Assembling furniture', suggests: ['hammer', 'headexplode', 'shrug'] },
  { id: 'ev-neighbour', pack: 'everyday', text: 'Loud neighbour upstairs', suggests: ['hammer', 'headexplode'] },
  { id: 'ev-goodbye', pack: 'everyday', text: 'Saying goodbye forever', suggests: ['wave', 'kiss'] },
  { id: 'ev-jobdone', pack: 'everyday', text: 'Finally fixing it', suggests: ['hammer', 'fistpump', 'clap'] },

  // ---- party -------------------------------------------------------------
  { id: 'pa-lastdance', pack: 'party', text: 'Last one on the dancefloor', suggests: ['disco', 'tektonik', 'handsair'] },
  { id: 'pa-djdrops', pack: 'party', text: 'The beat drops', suggests: ['handsair', 'fistpump', 'disco'] },
  { id: 'pa-nodance', pack: 'party', text: "I don't dance", suggests: ['shrug', 'dontsee'] },
  { id: 'pa-crush', pack: 'party', text: 'Spotting your crush', suggests: ['kiss', 'wave', 'dontsee'] },
  { id: 'pa-bill', pack: 'party', text: 'Who pays the bill?', suggests: ['money', 'dontsee', 'shrug'] },
  { id: 'pa-birthday', pack: 'party', text: 'Surprise birthday party', suggests: ['clap', 'handsair', 'kiss'] },
  { id: 'pa-karaoke', pack: 'party', text: 'Karaoke disaster', suggests: ['raiseHand', 'headexplode', 'clap'] },
  { id: 'pa-latearrival', pack: 'party', text: 'Arriving way too early', suggests: ['shrug', 'wave'] },
  { id: 'pa-robotdance', pack: 'party', text: 'The robot dance-off', suggests: ['robot', 'tektonik'] },
  { id: 'pa-encore', pack: 'party', text: 'Demanding an encore', suggests: ['clap', 'fistpump', 'raiseHand'] },

  // ---- internet ----------------------------------------------------------
  { id: 'in-viral', pack: 'internet', text: 'Going viral', suggests: ['fistpump', 'handsair', 'dab'] },
  { id: 'in-cringe', pack: 'internet', text: 'Deleting an old post', suggests: ['dontsee', 'headexplode'] },
  { id: 'in-crypto', pack: 'internet', text: 'Crypto goes to zero', suggests: ['money', 'headexplode', 'shrug'] },
  { id: 'in-airdrop', pack: 'internet', text: 'Free airdrop!', suggests: ['money', 'fistpump', 'clap'] },
  { id: 'in-lag', pack: 'internet', text: 'Terrible connection', suggests: ['robot', 'shrug', 'headexplode'] },
  { id: 'in-touchgrass', pack: 'internet', text: 'Touch grass', suggests: ['dontsee', 'shrug', 'wave'] },
  { id: 'in-livestream', pack: 'internet', text: 'Live on stream', suggests: ['wave', 'clap', 'handsair'] },
  { id: 'in-unfollow', pack: 'internet', text: 'Getting unfollowed', suggests: ['dontsee', 'shrug'] },
  { id: 'in-ai', pack: 'internet', text: 'The AI took my job', suggests: ['robot', 'headexplode', 'shrug'] },
  { id: 'in-dab', pack: 'internet', text: 'A very outdated meme', suggests: ['dab', 'tik', 'shrug'] },

  // ---- movies ------------------------------------------------------------
  { id: 'mo-hero', pack: 'movies', text: 'Superhero landing', suggests: ['fistpump', 'raiseHand'] },
  { id: 'mo-horror', pack: 'movies', text: 'Do not open that door', suggests: ['dontsee', 'headexplode'] },
  { id: 'mo-romance', pack: 'movies', text: 'The airport goodbye', suggests: ['wave', 'kiss'] },
  { id: 'mo-heist', pack: 'movies', text: 'The heist goes wrong', suggests: ['money', 'headexplode', 'dontsee'] },
  { id: 'mo-robot', pack: 'movies', text: 'Rise of the machines', suggests: ['robot', 'fistpump'] },
  { id: 'mo-oscar', pack: 'movies', text: 'Winning an award', suggests: ['clap', 'kiss', 'raiseHand'] },
  { id: 'mo-training', pack: 'movies', text: 'The training montage', suggests: ['fistpump', 'hammer', 'tektonik'] },
  { id: 'mo-ghost', pack: 'movies', text: 'Seeing a ghost', suggests: ['dontsee', 'headexplode', 'shrug'] },
  { id: 'mo-dance', pack: 'movies', text: 'The big dance finale', suggests: ['disco', 'handsair', 'clap'] },
  { id: 'mo-sequel', pack: 'movies', text: 'A pointless sequel', suggests: ['shrug', 'dontsee'] }
]

const BY_PACK: Record<PackId, Prompt[]> = {
  everyday: [],
  party: [],
  internet: [],
  movies: []
}
for (const p of PROMPTS) BY_PACK[p.pack].push(p)

export const PROMPTS_BY_ID: Record<string, Prompt> = {}
for (const p of PROMPTS) PROMPTS_BY_ID[p.id] = p

/**
 * Build one round's question: the answer plus 3 same-pack decoys, shuffled.
 * `rng` is injected so the host can generate a round deterministically from a
 * seed and every client can rebuild the identical option order.
 */
export function buildRound(
  rng: () => number,
  avoidIds: string[] = [],
  preferPack?: PackId
): { answerId: string; optionIds: string[] } {
  const fresh = PROMPTS.filter((p) => avoidIds.indexOf(p.id) === -1)

  // Today's featured pack gets first refusal on the answer. Once it is used up
  // the round falls back to the whole library instead of repeating itself — a
  // theme is meant to be a flavour, not a cage.
  const themed = preferPack === undefined ? [] : fresh.filter((p) => p.pack === preferPack)
  const pool = themed.length > 0 ? themed : fresh.length >= 4 ? fresh : PROMPTS

  const answer = pool[Math.floor(rng() * pool.length)]

  const siblings = BY_PACK[answer.pack].filter((p) => p.id !== answer.id)
  const decoys = shuffle(siblings, rng).slice(0, 3)

  // Tiny packs would starve the option list — top up from anywhere.
  while (decoys.length < 3) {
    const filler = PROMPTS[Math.floor(rng() * PROMPTS.length)]
    if (filler.id !== answer.id && decoys.every((d) => d.id !== filler.id)) decoys.push(filler)
  }

  const options = shuffle([answer, ...decoys], rng)
  return { answerId: answer.id, optionIds: options.map((p) => p.id) }
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

/** Mulberry32 — small, fast, and identical across clients for a given seed. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
