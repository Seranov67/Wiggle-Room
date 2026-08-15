/**
 * The scoreboard travels as one string inside the host-owned `Match` component.
 *
 * Format: `userId:score:streak:lastGained` records joined by `;`.
 * Chosen over a synced entity per player because it gives the host a single
 * atomic write and keeps late joiners consistent for free.
 */

export type ScoreRow = {
  userId: string
  score: number
  streak: number
  /** Points gained in the most recently scored round — drives the reveal screen. */
  lastGained: number
}

export function parseScores(raw: string): ScoreRow[] {
  if (raw === '') return []
  const rows: ScoreRow[] = []
  for (const chunk of raw.split(';')) {
    if (chunk === '') continue
    const parts = chunk.split(':')
    if (parts.length !== 4) continue
    rows.push({
      userId: parts[0],
      score: parseInt(parts[1], 10) || 0,
      streak: parseInt(parts[2], 10) || 0,
      lastGained: parseInt(parts[3], 10) || 0
    })
  }
  return rows
}

export function serialiseScores(rows: ScoreRow[]): string {
  return rows.map((r) => `${r.userId}:${Math.round(r.score)}:${r.streak}:${Math.round(r.lastGained)}`).join(';')
}

export function findScore(rows: ScoreRow[], userId: string): ScoreRow | null {
  const target = userId.toLowerCase()
  for (const r of rows) if (r.userId.toLowerCase() === target) return r
  return null
}

/** Returns the existing row for `userId`, appending a zeroed one if absent. */
export function ensureScore(rows: ScoreRow[], userId: string): ScoreRow {
  const existing = findScore(rows, userId)
  if (existing !== null) return existing
  const fresh: ScoreRow = { userId, score: 0, streak: 0, lastGained: 0 }
  rows.push(fresh)
  return fresh
}

/** Highest score first; ties broken by userId so every client renders the same order. */
export function ranked(rows: ScoreRow[]): ScoreRow[] {
  return rows.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.userId.toLowerCase() < b.userId.toLowerCase() ? -1 : 1
  })
}
