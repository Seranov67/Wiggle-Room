/**
 * The scoring rules, as pure functions.
 *
 * Deliberately free of imports — including `config`. Every tuning value arrives
 * as an argument instead, which keeps this module dependency-free, and a
 * dependency-free module is one that `node --test` can import directly without
 * a bundler or the Decentraland runtime standing in the way. These are the
 * rules most worth having tests for, so they are the rules kept testable.
 */

/**
 * Multiplier for `streak` consecutive correct guesses, clamped to the ends of
 * `table`. A streak of 0 or 1 both read as the first entry: the first correct
 * guess of a run is not yet a streak.
 */
export function streakMultiplier(streak: number, table: readonly number[]): number {
  if (table.length === 0) return 1
  return table[Math.min(Math.max(streak, 1) - 1, table.length - 1)]
}

/**
 * Bonus for answering early, decaying linearly to zero at the end of the act
 * phase. Guesses logged past the end of the phase — a late clock, a slow
 * frame — earn nothing rather than going negative.
 */
export function speedBonus(guessMs: number, actMs: number, maxBonus: number): number {
  if (actMs <= 0) return 0
  const remaining = 1 - guessMs / actMs
  return maxBonus * Math.max(0, Math.min(1, remaining))
}
