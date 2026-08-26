import { triggerEmote } from '~system/RestrictedActions'
import { REACTIONS } from '../config'

/**
 * The base emote set every Decentraland avatar owns — no wearables required,
 * so the wheel looks the same for a brand new guest as for a whale.
 *
 * `id` is what the renderer expects in `triggerEmote({ predefinedEmote })`.
 * That call types it as a plain string, so a misspelling fails exactly as
 * silently as a missing permission does — every id here is checked against
 * the client's own list.
 */
export type Emote = {
  id: string
  /**
   * Short enough to fit one line of a narrow tile. The wheel is twenty across
   * and the label is all there is to read, so every character costs width that
   * the performance would otherwise get to keep.
   */
  label: string
}

export const EMOTES: Emote[] = [
  { id: 'wave', label: 'Wave' },
  { id: 'clap', label: 'Clap' },
  { id: 'raiseHand', label: 'Raise' },
  { id: 'shrug', label: 'Shrug' },
  { id: 'dontsee', label: 'Hide' },
  { id: 'headexplode', label: 'Shock' },
  { id: 'money', label: 'Money' },
  { id: 'kiss', label: 'Kiss' },
  { id: 'fistpump', label: 'Yes' },
  { id: 'hammer', label: 'Hammer' },
  { id: 'robot', label: 'Robot' },
  { id: 'disco', label: 'Disco' },
  { id: 'handsair', label: 'Hands' },
  { id: 'tektonik', label: 'Tek' },
  { id: 'dab', label: 'Dab' },
  { id: 'tik', label: 'Tik' },

  // Action emotes. Everything above reacts to something; none of it can mime
  // the thing itself — no door to open, no punch, no fall — which left several
  // prompts to be acted entirely through the face.
  { id: 'openDoor', label: 'Door' },
  { id: 'throw', label: 'Throw' },
  { id: 'punch', label: 'Punch' },
  { id: 'knockOut', label: 'KO' }
]

/**
 * Fire an emote on the local avatar. Everyone else sees it through the normal
 * avatar comms channel, so we never have to replicate this ourselves.
 */
export function playEmote(id: string): void {
  triggerEmote({ predefinedEmote: id }).catch((err) => {
    console.log('[wiggle] emote failed', id, err)
  })
}

/**
 * What the audience may fire while somebody is performing.
 *
 * Four, not twenty. Every one of these is also a legal miming emote, so the
 * standing risk is a reaction being read as the performance — and the guard
 * against that is picking gestures that read unmistakably as an audience
 * enjoying itself, drawn from the corner of the set the prompt library leans
 * on least. `shrug` and `headexplode` are the two most-suggested emotes in the
 * whole library, which is precisely why neither is here.
 *
 * The labels are written for a reaction rather than reused from the wheel —
 * "Cheer" is what you are doing, "Hands" is what the mime is called — but the
 * ids are checked against `EMOTES` at load, because a misspelling here would
 * fail exactly as silently as a missing permission does.
 */
export const REACTION_EMOTES: Emote[] = (
  [
    ['clap', 'Clap'],
    ['handsair', 'Cheer'],
    ['disco', 'Dance'],
    ['dab', 'Nice']
  ] as const
).map(([id, label]) => {
  if (!EMOTES.some((e) => e.id === id)) throw new Error(`[wiggle] reaction "${id}" is not in the emote set`)
  return { id, label }
})

let lastReactionAt = -Infinity

/**
 * Fire a reaction, unless the last one is still playing.
 *
 * Returns whether it went out, which is only of interest to a test — the
 * player gets no error for pressing early, they simply see the emote they
 * already started still running.
 */
export function playReaction(id: string, nowMs: number = Date.now()): boolean {
  if (nowMs - lastReactionAt < REACTIONS.cooldownMs) return false
  lastReactionAt = nowMs
  playEmote(id)
  return true
}
