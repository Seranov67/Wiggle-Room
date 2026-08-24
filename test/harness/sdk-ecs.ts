/** Stands in for `@dcl/sdk/ecs`. Only the surface `src/game` actually uses. */
import { world, type ComponentDef, type EntityId } from './world.ts'

export const Schemas = {
  Int: { kind: 'Int' as const },
  String: { kind: 'String' as const }
}

/**
 * `Entity` is a type in the real SDK, but `net.ts` imports it in a value
 * import, and type stripping cannot tell the difference — so the binding has
 * to exist at runtime or the module fails to link.
 */
export const Entity = 0

export const engine = {
  addEntity: (): EntityId => world.addEntity(),
  removeEntity: (entity: EntityId): void => world.removeEntity(entity),
  defineComponent: (name: string, schema: Record<string, { kind: 'Int' | 'String' }>): ComponentDef =>
    world.defineComponent(name, schema),
  getEntitiesWith: (...comps: ComponentDef[]): Array<[EntityId, ...Record<string, unknown>[]]> => {
    if (comps.length === 0) return []
    const out: Array<[EntityId, ...Record<string, unknown>[]]> = []
    for (const [entity, first] of comps[0].entries()) {
      const rest = comps.slice(1).map((c) => c.getOrNull(entity))
      if (rest.some((r) => r === null)) continue
      out.push([entity, first, ...(rest as Record<string, unknown>[])])
    }
    return out
  },
  addSystem: (): void => {}
}

export const PlayerIdentityData = world.defineComponent('core::PlayerIdentityData', {
  address: { kind: 'String' }
})
