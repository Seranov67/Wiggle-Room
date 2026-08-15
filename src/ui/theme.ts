import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'

export const C = {
  ink: Color4.fromHexString('#12101aff'),
  panel: Color4.fromHexString('#1d1a2bee'),
  panelSolid: Color4.fromHexString('#1d1a2bff'),
  line: Color4.fromHexString('#3a3454ff'),
  text: Color4.fromHexString('#f4f1ffff'),
  dim: Color4.fromHexString('#a49dc4ff'),
  hot: Color4.fromHexString('#ff5c8aff'),
  mint: Color4.fromHexString('#7cf6d4ff'),
  amber: Color4.fromHexString('#ffc65cff'),
  bad: Color4.fromHexString('#ff6b6bff'),
  clear: Color4.create(0, 0, 0, 0)
}

/**
 * Everything on screen is sized off one number so the layout holds on a 375pt
 * phone and on a 2560px monitor without a second set of styles.
 *
 * The reference width is 1280 virtual px; below ~700 we stop shrinking, because
 * touch targets have a hard floor regardless of how small the canvas is.
 */
export function canvas(): { width: number; height: number; portrait: boolean; scale: number; touch: boolean } {
  const info = UiCanvasInformation.getOrNull(engine.RootEntity)
  const width = info?.width ?? 1280
  const height = info?.height ?? 720
  const portrait = height > width
  const touch = width < 900
  const scale = Math.max(0.78, Math.min(1.35, width / 1280))
  return { width, height, portrait, scale, touch }
}

/** Font size in virtual px, floored so labels stay legible on a phone. */
export function fs(base: number): number {
  const { scale } = canvas()
  return Math.max(14, Math.round(base * scale))
}

/** Generic length scaling with no floor — for paddings and gaps. */
export function px(base: number): number {
  const { scale } = canvas()
  return Math.round(base * scale)
}

/**
 * Height of a primary tap target. Apple/Google both put the comfortable
 * minimum around 44–48pt; we go bigger because players tap these while
 * watching an avatar dance.
 */
export function tapHeight(): number {
  const { touch, scale } = canvas()
  return Math.round((touch ? 76 : 64) * scale)
}
