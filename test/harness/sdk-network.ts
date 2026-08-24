/** Stands in for `@dcl/sdk/network`. */
import { world, type EntityId } from './world.ts'

export const myProfile = {
  get userId(): string {
    return world.currentActor
  }
}

export function syncEntity(entity: EntityId, _componentIds: number[], id?: number): void {
  world.syncEntity(entity, id)
}

export function isStateSyncronized(): boolean {
  return world.synced
}
