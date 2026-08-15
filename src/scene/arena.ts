import {
  engine,
  Entity,
  Material,
  MeshRenderer,
  TextAlignMode,
  TextShape,
  Transform,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { ARENA } from '../config'
import { Phase } from '../game/components'
import { amActor, currentMatch, secondsLeft } from '../game/machine'
import { getPlayer } from '@dcl/sdk/players'
import { PROMPTS_BY_ID } from '../game/prompts'

/**
 * The room itself. Everything is built from primitives on purpose: no GLB
 * downloads means the scene is interactive within a second on a phone, which
 * is most of the battle for mobile-first judging.
 */

const INK = Color4.fromHexString('#12101aff')
const STAGE = Color4.fromHexString('#ff5c8aff')
const RING = Color4.fromHexString('#2b2740ff')
const GLOW = Color4.fromHexString('#7cf6d4ff')

let backdropText: Entity
let spotlight: Entity

export function buildArena(): void {
  floor()
  stage()
  audienceRing()
  backdrop()
  spotlight = actorSpotlight()

  engine.addSystem(spotlightSystem)
  engine.addSystem(backdropSystem)
}

function floor(): void {
  const e = engine.addEntity()
  Transform.create(e, {
    position: Vector3.create(8, 0.02, 8),
    scale: Vector3.create(16, 0.04, 16)
  })
  MeshRenderer.setBox(e)
  paint(e, INK)
}

function stage(): void {
  const e = engine.addEntity()
  Transform.create(e, {
    position: Vector3.create(ARENA.stage.x, 0.12, ARENA.stage.z),
    scale: Vector3.create(ARENA.stageRadius * 2, 0.24, ARENA.stageRadius * 2)
  })
  MeshRenderer.setCylinder(e, 1, 1)
  paint(e, STAGE, 0.45)
}

/** A low ring of blocks that reads as seating and keeps guessers facing in. */
function audienceRing(): void {
  const seats = 16
  for (let i = 0; i < seats; i++) {
    const angle = (i / seats) * Math.PI * 2
    const e = engine.addEntity()
    Transform.create(e, {
      position: Vector3.create(
        ARENA.stage.x + Math.cos(angle) * ARENA.ringRadius,
        0.25,
        ARENA.stage.z + Math.sin(angle) * ARENA.ringRadius
      ),
      rotation: Quaternion.fromEulerDegrees(0, -(angle * 180) / Math.PI, 0),
      scale: Vector3.create(1.1, 0.5, 0.9)
    })
    MeshRenderer.setBox(e)
    paint(e, RING)
  }
}

/** Big readable status board behind the stage — the thing a spectator reads first. */
function backdrop(): void {
  const panel = engine.addEntity()
  Transform.create(panel, {
    position: Vector3.create(ARENA.stage.x, 3.4, 0.6),
    scale: Vector3.create(11, 4.4, 0.2)
  })
  MeshRenderer.setBox(panel)
  paint(panel, RING)

  backdropText = engine.addEntity()
  Transform.create(backdropText, {
    position: Vector3.create(ARENA.stage.x, 3.4, 0.85),
    scale: Vector3.create(1, 1, 1)
  })
  TextShape.create(backdropText, {
    text: 'WIGGLE ROOM',
    fontSize: 4,
    textColor: GLOW,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    width: 10,
    height: 4,
    textWrapping: true
  })
}

/** A halo that parks itself over whoever is on stage. */
function actorSpotlight(): Entity {
  const e = engine.addEntity()
  Transform.create(e, {
    position: Vector3.create(ARENA.stage.x, 2.6, ARENA.stage.z),
    scale: Vector3.create(1.4, 0.06, 1.4)
  })
  MeshRenderer.setCylinder(e, 1, 1)
  paint(e, GLOW, 0.8)
  VisibilityComponent.create(e, { visible: false })
  return e
}

let spin = 0

function spotlightSystem(dt: number): void {
  const m = currentMatch()
  const active = m !== null && (m.phase === Phase.Act || m.phase === Phase.Pick) && m.actorId !== ''
  VisibilityComponent.getMutable(spotlight).visible = active
  if (!active || m === null) return

  const actor = getPlayer({ userId: m.actorId })
  const pos = actor?.position
  spin = (spin + dt * 90) % 360

  const t = Transform.getMutable(spotlight)
  t.position = Vector3.create(
    pos ? pos.x : ARENA.stage.x,
    (pos ? pos.y : 0) + 2.4,
    pos ? pos.z : ARENA.stage.z
  )
  t.rotation = Quaternion.fromEulerDegrees(0, spin, 0)
}

function backdropSystem(): void {
  const m = currentMatch()
  const text = TextShape.getMutable(backdropText)

  if (m === null) {
    text.text = 'WIGGLE ROOM\nconnecting...'
    return
  }

  switch (m.phase) {
    case Phase.Lobby:
      text.text = 'WIGGLE ROOM\nwaiting for players'
      break
    case Phase.Starting:
      text.text = `starting in ${secondsLeft()}`
      break
    case Phase.Pick:
      text.text = amActor() ? 'YOUR TURN\npick a prompt' : 'the actor is choosing...'
      break
    case Phase.Act:
      text.text = amActor() ? `ACT IT OUT\n${secondsLeft()}s` : `WHAT IS IT?\n${secondsLeft()}s`
      break
    case Phase.Reveal:
      text.text = m.answerId === '' ? 'round voided' : (PROMPTS_BY_ID[m.answerId]?.text ?? '?').toUpperCase()
      break
    case Phase.Intermission:
      text.text = 'next up...'
      break
    case Phase.MatchEnd:
      text.text = 'FINAL SCORES'
      break
  }
}

function paint(entity: Entity, color: Color4, emissiveIntensity = 0): void {
  Material.setPbrMaterial(entity, {
    albedoColor: color,
    roughness: 0.9,
    metallic: 0,
    emissiveColor: emissiveIntensity > 0 ? Color3.create(color.r, color.g, color.b) : undefined,
    emissiveIntensity
  })
}
