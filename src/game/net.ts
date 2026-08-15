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
  const present = new Set<string>()
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (identity.address !== '') present.add(identity.address.toLowerCase())
  }
  const me = myUserId()
  if (me !== '') present.add(me.toLowerCase())
  return present
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
  const present = presentUserIds()
  const seen = new Set<string>()
  const out: RosterEntry[] = []

  for (const [entity, w] of engine.getEntitiesWith(Wiggler)) {
    const id = w.userId.toLowerCase()
    if (id === '' || !present.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push({ entity, userId: w.userId, name: w.name || 'Anon' })
  }

  out.sort((a, b) => (a.userId.toLowerCase() < b.userId.toLowerCase() ? -1 : 1))
  return out
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
