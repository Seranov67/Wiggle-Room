import { engine } from '@dcl/sdk/ecs'
import { buildArena } from './scene/arena'
import { setupUi } from './ui/root'
import { initNet, invalidateRoster, refreshSelfIdentity } from './game/net'
import { hostTick, localTick } from './game/machine'

export function main() {
  initNet()
  buildArena()
  setupUi()

  engine.addSystem(gameSystem)
}

/**
 * One system drives the whole game.
 *
 * `hostTick` no-ops on every client except the elected host, so this is safe to
 * run everywhere — and when the host walks out, the next client picks the match
 * up on its very next frame without any handover message.
 */
function gameSystem(dt: number): void {
  refreshSelfIdentity()
  invalidateRoster()
  localTick(dt)
  hostTick(dt)
}
