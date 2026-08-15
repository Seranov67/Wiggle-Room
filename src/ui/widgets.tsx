import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { C, fs, px, tapHeight } from './theme'

/**
 * Shared building blocks. Rule of thumb applied throughout: anything the player
 * must hit with a thumb is a full-width or half-width block, never an icon.
 */

export type BigButtonProps = {
  /** React reconciler key — consumed by the VDOM, not forwarded to the component. */
  key?: string
  label: string
  onClick: () => void
  /** Visual state — `idle` is the default outline, the rest are result colours. */
  tone?: 'idle' | 'selected' | 'correct' | 'wrong' | 'muted'
  disabled?: boolean
  /** Small text in the corner, e.g. a vote count at reveal. */
  badge?: string
  /** Accept any CSS-like size string (e.g. '100%', '48%') or a pixel number. */
  width?: string | number
  height?: number
}

export function BigButton(props: BigButtonProps) {
  const tone = props.tone ?? 'idle'
  const fill = toneFill(tone)
  const border = toneBorder(tone)

  return (
    <UiEntity
      uiTransform={{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        width: (props.width ?? '100%') as any,
        height: props.height ?? tapHeight(),
        margin: { top: px(6), bottom: px(6) },
        padding: { left: px(14), right: px(14) },
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: px(2),
        borderColor: border,
        borderRadius: px(14),
        pointerFilter: props.disabled === true ? 'none' : 'block'
      }}
      uiBackground={{ color: fill }}
      onMouseDown={props.disabled === true ? undefined : props.onClick}
    >
      <Label
        value={props.badge ? `${props.label}   <color=#a49dc4>${props.badge}</color>` : props.label}
        fontSize={fs(22)}
        color={tone === 'muted' ? C.dim : C.text}
        textAlign="middle-center"
        uiTransform={{ width: '100%', height: '100%' }}
      />
    </UiEntity>
  )
}

function toneFill(tone: NonNullable<BigButtonProps['tone']>): Color4 {
  switch (tone) {
    case 'selected':
      return Color4.create(C.hot.r, C.hot.g, C.hot.b, 0.32)
    case 'correct':
      return Color4.create(C.mint.r, C.mint.g, C.mint.b, 0.3)
    case 'wrong':
      return Color4.create(C.bad.r, C.bad.g, C.bad.b, 0.24)
    case 'muted':
      return Color4.create(C.panel.r, C.panel.g, C.panel.b, 0.5)
    default:
      return C.panel
  }
}

function toneBorder(tone: NonNullable<BigButtonProps['tone']>): Color4 {
  switch (tone) {
    case 'selected':
      return C.hot
    case 'correct':
      return C.mint
    case 'wrong':
      return C.bad
    case 'muted':
      return C.line
    default:
      return C.line
  }
}

/** Horizontal countdown that drains left to right. */
export function TimerBar(props: { remaining01: number; color?: Color4 }) {
  const pct = Math.max(0, Math.min(1, props.remaining01))
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: px(8),
        borderRadius: px(4),
        margin: { top: px(4), bottom: px(8) }
      }}
      uiBackground={{ color: C.line }}
    >
      <UiEntity
        uiTransform={{ width: `${pct * 100}%`, height: '100%', borderRadius: px(4) }}
        uiBackground={{ color: props.color ?? C.mint }}
      />
    </UiEntity>
  )
}

export function Card(props: { children?: unknown; padding?: number }) {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        flexDirection: 'column',
        padding: props.padding ?? px(16),
        borderRadius: px(18),
        borderWidth: px(1),
        borderColor: C.line
      }}
      uiBackground={{ color: C.panel }}
    >
      {props.children}
    </UiEntity>
  )
}

export function Title(props: { text: string; color?: Color4; size?: number }) {
  return (
    <Label
      value={props.text}
      fontSize={fs(props.size ?? 30)}
      color={props.color ?? C.text}
      textAlign="middle-center"
      uiTransform={{ width: '100%', height: fs((props.size ?? 30) * 1.5) }}
    />
  )
}

export function Caption(props: { text: string; color?: Color4 }) {
  return (
    <Label
      value={props.text}
      fontSize={fs(17)}
      color={props.color ?? C.dim}
      textAlign="middle-center"
      uiTransform={{ width: '100%', height: fs(26) }}
    />
  )
}

/** Two-column grid; children are laid out by the caller in pairs. */
export function Row(props: { children?: unknown; gap?: number }) {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}
    >
      {props.children}
    </UiEntity>
  )
}
