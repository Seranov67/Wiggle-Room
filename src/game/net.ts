import { engine, Entity, PlayerIdentityData } from '@dcl/sdk/ecs'
import { myProfile, syncEntity, isStateSyncronized } from '@dcl/sdk/network'
import { getPlayer } from '@dcl/sdk/players'
import { Match, Wiggler, SyncId } from './components'

/**
 * Networking layer. Two jobs:
 *
 *  1. Own exactly one `Wiggler` entity per client and keep it synced.
 *  2. Elect a host deterministically, so one — and only one — client runs the
 *     match state machine. Election is "lowest userId present wins", which
 *     every client can compute independently from the same data, so there is
 *     no handshake to get wrong and handover is automatic when the host leaves.
 */

let matchEntity: Entity | null = null
let selfEntity: Entity | null = null

/**
 * The roster is derived state: two full entity scans, two sets and a sort. It
 * is also read a dozen times a frame — five times inside `hostTick` alone, and
 * once per scoreboard row by the UI, which re-renders continuously. Computing
 * the identical list that often is pure waste on a device that has to hold a
 * frame rate, so it is built once a frame and reused.
 */
let rosterCache: RosterEntry[] | null = null
let presentCache: Set<string> | null = null

/**
 * Drop the cached roster. Called once a frame from the game system, and
 * deliberately *after* `refreshSelfIdentity`: that call can be the thing which
 * writes our own userId, and a roster cached before it would be missing us.
 */
export function invalidateRoster(): void {
  rosterCache = null
  presentCache = null
}

export function initNet(): void {
  matchEntity = engine.addEntity()
  syncEntity(matchEntity, [Match.componentId], SyncId.Match)

  selfEntity = engine.addEntity()
  Wiggler.create(selfEntity, {
    userId: '',
    name: '',
    roundIndex: -1,
    choiceId: '',
    guessId: '',
    guessMs: 0
  })
  syncEntity(selfEntity, [Wiggler.componentId])
}

export function getMatchEntity(): Entity {
  if (matchEntity === null) throw new Error('initNet() must run before the match entity is used')
  return matchEntity
}

export function getSelfEntity(): Entity {
  if (selfEntity === null) throw new Error('initNet() must run before the self entity is used')
  return selfEntity
}

/** Our own wallet/guest address. Empty string until the profile resolves. */
export function myUserId(): string {
  return myProfile.userId ?? ''
}

export function networkReady(): boolean {
  return myUserId() !== '' && isStateSyncronized()
}

/**
 * Fill in our identity once the profile has resolved. Cheap enough to call
 * every frame; it only writes when something actually changed.
 */
export function refreshSelfIdentity(): void {
  if (selfEntity === null) return
  const id = myUserId()
  if (id === '') return

  const me = Wiggler.getOrNull(selfEntity)
  if (me === null) return

  const profile = getPlayer()
  const name = profile?.name ?? 'Anon'
  if (me.userId === id && me.name === name) return

  const mut = Wiggler.getMutable(selfEntity)
  mut.userId = id
  mut.name = name
}

/**
 * userIds the renderer currently reports as being inside the scene. This is the
 * liveness source of truth — synced `Wiggler` entities of players who walked
 * away stick around in the engine, and scoring them would be wrong.
 */
function presentUserIds(): Set<string> {
  if (presentCache !== null) return presentCache

  const present = new Set<string>()
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (identity.address !== '') present.add(identity.address.toLowerCase())
  }
  const me = myUserId()
  if (me !== '') present.add(me.toLowerCase())

  presentCache = present
  return present
}

/**
 * Is this userId inside the scene right now, according to the renderer?
 *
 * Deliberately reads `PlayerIdentityData` rather than our own `Wiggler`: it
 * stays truthful about clients running a different build of the scene, whose
 * synced components we may not be able to read at all.
 */
export function isPresent(userId: string): boolean {
  return userId !== '' && presentUserIds().has(userId.toLowerCase())
}

export type RosterEntry = {
  entity: Entity
  userId: string
  name: string
}

/**
 * Everyone currently in the scene who has a synced `Wiggler`, sorted by userId
 * so the ordering is identical on every client.
 */
export function roster(): RosterEntry[] {
  if (rosterCache !== null) return rosterCache

  const present = presentUserIds()
  /** userId -> the entry we are keeping, and how far along its data is. */
  const best = new Map<string, { entry: RosterEntry; roundIndex: number }>()

  for (const [entity, w] of engine.getEntitiesWith(Wiggler)) {
    const id = w.userId.toLowerCase()
    if (id === '' || !present.has(id)) continue

    const name = w.name || 'Anon'
    if (name !== 'Anon') knownNames.set(id, name)

    // A player who leaves and comes back has two `Wiggler` entities: the one
    // they left behind — synced state outlives the client that wrote it — and
    // the one their new session made. Taking whichever the engine happened to
    // list first picked the corpse about as often as the player, and a round
    // then cannot see their pick or their guess at all.
    //
    // `roundIndex` settles it without a protocol change: the entity that has
    // been written for the newest round is the live one. A returning player is
    // still on the stale entity until they touch something, which is correct —
    // until they do, they have not picked or guessed.
    const held = best.get(id)
    if (held !== undefined && held.roundIndex >= w.roundIndex) continue
    best.set(id, { entry: { entity, userId: w.userId, name }, roundIndex: w.roundIndex })
  }

  const out = [...best.values()].map((held) => held.entry)
  out.sort((a, b) => (a.userId.toLowerCase() < b.userId.toLowerCase() ? -1 : 1))

  rosterCache = out
  return out
}

/**
 * Display names we have seen, kept after the player leaves.
 *
 * The scoreboard outlives the roster: a player who walks out mid-match still
 * has a score, and looking their name up in the roster then fails. Without
 * this the final standings list a raw wallet address next to the points of the
 * person who just left.
 */
const knownNames = new Map<string, string>()

/** The display name for a userId, remembered even after they leave the room. */
export function nameFor(userId: string): string | null {
  return knownNames.get(userId.toLowerCase()) ?? null
}

/** Lowest userId present. Returns '' when the roster is not usable yet. */
export function hostId(): string {
  const list = roster()
  return list.length > 0 ? list[0].userId : ''
}

export function isHost(): boolean {
  const me = myUserId()
  return me !== '' && hostId().toLowerCase() === me.toLowerCase()
}

export function findWiggler(userId: string): RosterEntry | null {
  const target = userId.toLowerCase()
  for (const entry of roster()) {
    if (entry.userId.toLowerCase() === target) return entry
  }
  return null
}
