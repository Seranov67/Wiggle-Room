/** Stands in for `@dcl/sdk/players`. */
import { world } from './world.ts'

export function getPlayer(opts?: { userId?: string }) {
  return world.profileOf(opts?.userId ?? world.currentActor)
}
