import { triggerEmote, stopEmote } from '~system/RestrictedActions'

/**
 * The base emote set every Decentraland avatar owns — no wearables required,
 * so the wheel looks the same for a brand new guest as for a whale.
 *
 * `id` is what the renderer expects in `triggerEmote({ predefinedEmote })`.
 */
export type Emote = {
  id: string
  /** Short enough to fit a thumb-sized button. */
  label: string
  /** Fallback glyph so the wheel is readable before art exists. */
  glyph: string
}

export const EMOTES: Emote[] = [
  { id: 'wave', label: 'Wave', glyph: '👋' },
  { id: 'clap', label: 'Clap', glyph: '👏' },
  { id: 'raiseHand', label: 'Raise', glyph: '🙋' },
  { id: 'shrug', label: 'Shrug', glyph: '🤷' },
  { id: 'dontsee', label: "Can't look", glyph: '🙈' },
  { id: 'headexplode', label: 'Mind blown', glyph: '🤯' },
  { id: 'money', label: 'Money', glyph: '💸' },
  { id: 'kiss', label: 'Kiss', glyph: '😘' },
  { id: 'fistpump', label: 'Yes!', glyph: '✊' },
  { id: 'hammer', label: 'Hammer', glyph: '🔨' },
  { id: 'robot', label: 'Robot', glyph: '🤖' },
  { id: 'disco', label: 'Disco', glyph: '🕺' },
  { id: 'handsair', label: 'Hands up', glyph: '🙌' },
  { id: 'tektonik', label: 'Tektonik', glyph: '💃' },
  { id: 'dab', label: 'Dab', glyph: '😎' },
  { id: 'tik', label: 'Tik', glyph: '🎵' }
]

export const EMOTES_BY_ID: Record<string, Emote> = {}
for (const e of EMOTES) EMOTES_BY_ID[e.id] = e

/**
 * Fire an emote on the local avatar. Everyone else sees it through the normal
 * avatar comms channel, so we never have to replicate this ourselves.
 */
export function playEmote(id: string): void {
  triggerEmote({ predefinedEmote: id }).catch((err) => {
    console.log('[wiggle] emote failed', id, err)
  })
}

export function clearEmote(): void {
  stopEmote({}).catch(() => {
    // Older explorers may not implement stopEmote; a stuck emote is harmless.
  })
}
