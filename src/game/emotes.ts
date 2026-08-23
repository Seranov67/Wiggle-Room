import { triggerEmote } from '~system/RestrictedActions'

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
