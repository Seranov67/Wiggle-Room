/**
 * A fake Decentraland world, shared by every simulated client in a test.
 *
 * The real thing gives each client its own copy of the ECS and reconciles them
 * over CRDT. Here there is one store and sync is instant, which is the honest
 * model for what these tests are for: the state machine's *decisions*, not the
 * transport. What the transport can actually do to us — a player flickering out
 * of the roster for a frame — is reproduced directly, by taking them out of the
 * world and putting them back.
 */

export type EntityId = number

export type FieldSpec = { kind: 'Int' | 'String' }
export type ComponentSchema = Record<string, FieldSpec>

export type ComponentDef = {
  componentId: number
  create(entity: EntityId, value?: Record<string, unknown>): Record<string, unknown>
  createOrReplace(entity: EntityId, value?: Record<string, unknown>): Record<string, unknown>
  get(entity: EntityId): Record<string, unknown>
  getOrNull(entity: EntityId): Record<string, unknown> | null
  getMutable(entity: EntityId): Record<string, unknown>
  has(entity: EntityId): boolean
  deleteFrom(entity: EntityId): void
  entries(): Array<[EntityId, Record<string, unknown>]>
  clear(): void
}

export type Profile = { userId: string; name: string; position: { x: number; y: number; z: number } }

/** Where a player stands unless a test moves them: the middle of the stage. */
const DEFAULT_POSITION = { x: 8, y: 0, z: 8 }

function defaultsFor(schema: ComponentSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [field, spec] of Object.entries(schema)) out[field] = spec.kind === 'Int' ? 0 : ''
  return out
}

class World {
  private nextEntity = 512
  private nextComponentId = 1
  /** Local entity -> the one entity they all mean, once `syncEntity` has aliased them. */
  private alias = new Map<EntityId, EntityId>()
  /** Network sync id -> the entity that claimed it first. */
  private claimed = new Map<number, EntityId>()
  private components = new Map<string, ComponentDef>()
  private profiles = new Map<string, Profile>()
  private presence = new Map<string, EntityId>()

  /** Whose frame is running right now. `myProfile.userId` reads this. */
  currentActor = ''
  /** Flip to false to simulate a client that has not finished syncing. */
  synced = true

  /**
   * Empty the world between tests without discarding the component
   * definitions. The fake `@dcl/sdk/ecs` is a singleton that captured
   * `PlayerIdentityData` at import time, so dropping the definitions would
   * leave it holding a store nothing else writes to.
   */
  reset(): void {
    for (const comp of this.components.values()) comp.clear()
    this.alias.clear()
    this.claimed.clear()
    this.presence.clear()
    this.profiles.clear()
    this.currentActor = ''
    this.synced = true
  }

  addEntity(): EntityId {
    return this.nextEntity++
  }

  removeEntity(entity: EntityId): void {
    const target = this.canonical(entity)
    for (const comp of this.components.values()) comp.deleteFrom(target)
  }

  /** Follow the alias chain to the entity that actually holds the data. */
  canonical(entity: EntityId): EntityId {
    return this.alias.get(entity) ?? entity
  }

  /**
   * What a fixed sync id buys you: every client's own entity resolves to one
   * shared entity, so the singleton `Match` really is a singleton. Entities
   * synced without an id — every player's own `Wiggler` — stay their own.
   */
  syncEntity(entity: EntityId, id?: number): void {
    if (id === undefined) return
    const owner = this.claimed.get(id)
    if (owner === undefined) this.claimed.set(id, entity)
    else this.alias.set(entity, owner)
  }

  defineComponent(name: string, schema: ComponentSchema): ComponentDef {
    const existing = this.components.get(name)
    // Every client calls this with the same name. They must land on one store,
    // exactly as they land on one component in a real room.
    if (existing) return existing

    const store = new Map<EntityId, Record<string, unknown>>()
    const world = this
    const write = (entity: EntityId, value?: Record<string, unknown>) => {
      const row = { ...defaultsFor(schema), ...(value ?? {}) }
      store.set(world.canonical(entity), row)
      return row
    }

    const def: ComponentDef = {
      componentId: this.nextComponentId++,
      create: write,
      createOrReplace: write,
      get(entity) {
        const row = store.get(world.canonical(entity))
        if (row === undefined) throw new Error(`${name} is not present on entity ${entity}`)
        return row
      },
      getOrNull(entity) {
        return store.get(world.canonical(entity)) ?? null
      },
      // The real `getMutable` hands back the stored record and marks it dirty;
      // `get` hands back the same record behind a readonly *type*. Both are the
      // same object at runtime, so one store serves both.
      getMutable(entity) {
        return def.get(entity)
      },
      has(entity) {
        return store.has(world.canonical(entity))
      },
      deleteFrom(entity) {
        store.delete(world.canonical(entity))
      },
      entries() {
        return [...store.entries()]
      },
      clear() {
        store.clear()
      }
    }

    this.components.set(name, def)
    return def
  }

  // -- players ------------------------------------------------------------

  /**
   * Put a player in the scene. Only presence is created here; their `Wiggler`
   * is created by their own client, the way the real one is.
   */
  join(userId: string, name: string): void {
    const key = userId.toLowerCase()
    this.profiles.set(key, { userId, name, position: { ...DEFAULT_POSITION } })
    if (!this.presence.has(key)) {
      const entity = this.addEntity()
      this.identity().create(entity, { address: userId })
      this.presence.set(key, entity)
    }
  }

  /**
   * Take a player out of the scene.
   *
   * Their `Wiggler` deliberately stays behind: synced components outlive the
   * client that wrote them, which is the whole reason `isPresent` reads
   * `PlayerIdentityData` instead of our own components.
   */
  leave(userId: string): void {
    const key = userId.toLowerCase()
    const entity = this.presence.get(key)
    if (entity !== undefined) {
      this.identity().deleteFrom(entity)
      this.presence.delete(key)
    }
    this.profiles.delete(key)
  }

  isPresent(userId: string): boolean {
    return this.presence.has(userId.toLowerCase())
  }

  moveTo(userId: string, x: number, z: number): void {
    const profile = this.profiles.get(userId.toLowerCase())
    if (profile) profile.position = { x, y: 0, z }
  }

  profileOf(userId: string): Profile | null {
    return this.profiles.get(userId.toLowerCase()) ?? null
  }

  private identity(): ComponentDef {
    return this.defineComponent('core::PlayerIdentityData', { address: { kind: 'String' } })
  }
}

export const world = new World()
