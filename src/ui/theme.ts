import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'

export const C = {
  ink: Color4.fromHexString('#12101aff'),
  panel: Color4.fromHexString('#1d1a2bcc'),
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

type CanvasInfo = { width: number; height: number; portrait: boolean; scale: number; touch: boolean }

let sizeCache: CanvasInfo | null = null
let cachedWidth = -1
let cachedHeight = -1

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

  // Layout is a pure function of the canvas size, and this is called dozens of
  // times per frame — six times per emote tile alone, sixteen tiles deep. It
  // used to allocate a fresh object every time, which is a lot of garbage for
  // an answer that only changes when the window does.
  if (sizeCache !== null && cachedWidth === width && cachedHeight === height) return sizeCache
  const portrait = height > width
  // 1100, not 900: a tablet in landscape is 1024 wide and is emphatically a
  // touch device. Being wrong on a small desktop window costs us a slightly
  // chunky UI; being wrong on a tablet costs buttons too small to hit.
  const touch = width < 1100
  const scale = Math.max(0.78, Math.min(1.35, width / 1280))

  cachedWidth = width
  cachedHeight = height
  sizeCache = { width, height, portrait, scale, touch }
  return sizeCache
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
 *
 * The floor is not decoration. Without it, crossing the touch threshold used
 * to *shrink* the target — the smaller base met a still-clamped scale — so the
 * devices most in need of a big button got the smallest one in the range.
 */
export function tapHeight(): number {
  const { touch, scale } = canvas()
  return Math.max(56, Math.round((touch ? 76 : 64) * scale))
}
