/**
 * Stands in for `~system/RestrictedActions`.
 *
 * The real `triggerEmote` takes a plain string and resolves whether or not the
 * emote exists, which is why a typo in an id is invisible until somebody
 * watches an avatar fail to move. Recording the calls is the only way a test
 * can see what was actually asked for.
 */
const fired: string[] = []

export function triggerEmote(payload: { predefinedEmote: string }): Promise<void> {
  fired.push(payload.predefinedEmote)
  return Promise.resolve()
}

/** Emote ids asked for since the last clear, oldest first. */
export function emotesFired(): string[] {
  return [...fired]
}

export function clearEmotes(): void {
  fired.length = 0
}
