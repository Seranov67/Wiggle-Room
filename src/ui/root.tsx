import ReactEcs, { Label, ReactEcsRenderer, ScreenInsetArea, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { C, canvas, fs, px, tapHeight } from './theme'
import { BigButton, Caption, Card, TimerBar, Title } from './widgets'
import { Phase } from '../game/components'
import {
  amActor,
  commitChoice,
  commitGuess,
  commitDemoChoice,
  currentMatch,
  demoChoice,
  DemoPhase,
  demoOptionIds,
  demoPhaseNow,
  demoRemaining01,
  demoSecondsLeft,
  endDemo,
  getVotesForRound,
  readersOf,
  isOnStage,
  myChoice,
  myGuess,
  optionIds,
  phaseRemaining01,
  protocolOk,
  scoreRows,
  secondsLeft,
  startDemo
} from '../game/machine'
import { PACK_NAMES, packForDay, PROMPTS_BY_ID } from '../game/prompts'
import { EMOTES, playEmote } from '../game/emotes'
import { myUserId, nameFor, networkReady, roster } from '../game/net'
import { ranked, findScore } from '../game/scoreboard'
import { RULES } from '../config'

export function setupUi(): void {
  // 'none' because the tree already wraps itself in ScreenInsetArea. Since 7.26
  // the renderer applies the device safe area by default, so leaving it on the
  // default meant every measurement below was taken inside an area that had
  // already been inset once — and the layout was tuned against those numbers.
  ReactEcsRenderer.setUiRenderer(() => <Root />, { screenInset: 'none' })
}

/**
 * The whole interface is one bottom sheet.
 *
 * Why a sheet and not a centred dialog: on a phone the top half of the screen
 * is where the avatars are, and the bottom third is the only place a thumb
 * reaches comfortably. Everything interactive lives down there; everything
 * informational is a line of text above it.
 */
function Root() {
  const { portrait, width, height } = canvas()

  // The mobile client runs landscape and paints its own controls over the
  // screen edges — movement lower-left, jump and the action buttons on the
  // right. A sheet sized for a desktop reaches underneath them, and the last
  // column of the emote grid stops being tappable at all. A short viewport is
  // the tell: desktops are rarely under 720 tall, landscape phones always are.
  const nativeControls = height < 720
  const sheetWidth = portrait
    ? width - px(24)
    : Math.min(width - px(24), nativeControls ? 560 : 860)

  return (
    <ScreenInsetArea
      uiTransform={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        // Landscape puts the player's own avatar dead centre, and a sheet
        // parked there covers the one thing the game asks you to look at: the
        // emotes you just triggered. Pushed to the left, the middle stays clear
        // and the client's own buttons on the right stay reachable.
        alignItems: nativeControls && !portrait ? 'flex-start' : 'center'
      }}
    >
      <UiEntity
        uiTransform={{
          width: sheetWidth,
          flexDirection: 'column',
          alignItems: 'center',
          margin: { bottom: px(18), left: nativeControls && !portrait ? px(24) : 0 }
        }}
      >
        <Sheet />
      </UiEntity>
    </ScreenInsetArea>
  )
}

function Sheet() {
  if (!networkReady()) return <Connecting />

  const m = currentMatch()
  if (m === null) return <Connecting />

  if (!protocolOk()) return <OutOfDate />
  if (demoPhaseNow() !== DemoPhase.Off) return <DemoScreen />

  switch (m.phase) {
    case Phase.Lobby:
      return <LobbyScreen />
    case Phase.Starting:
      return <CountdownScreen title="Get ready" caption={`Round 1 in ${secondsLeft()}`} />
    case Phase.Pick:
      return amActor() ? <ActorPickScreen /> : <WaitingScreen caption="The actor is choosing a prompt..." />
    case Phase.Act:
      return amActor() ? <ActorActScreen /> : <GuessScreen />
    case Phase.Reveal:
      return <RevealScreen />
    case Phase.Intermission:
      return <CountdownScreen title="Next up" caption={nextUpCaption()} />
    case Phase.MatchEnd:
      return <MatchEndScreen />
    default:
      return <Connecting />
  }
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function Connecting() {
  return (
    <Card>
      <Title text="Wiggle Room" color={C.hot} />
      <Caption text="connecting to the room..." />
    </Card>
  )
}

/** The room is running a different build of the game than this client. */
function OutOfDate() {
  return (
    <Card>
      <Title text="Out of date" color={C.bad} />
      <Caption text="this room is running a newer version of Wiggle Room" />
      <Caption text="reload the scene to join in" />
    </Card>
  )
}

function LobbyScreen() {
  const players = roster()
  const needed = Math.max(0, RULES.minPlayers - players.length)

  return (
    <Card>
      <Title text="Wiggle Room" color={C.hot} />
      <Caption text={`today's theme — ${PACK_NAMES[packForDay()]}`} color={C.amber} />
      <Caption
        text={
          needed > 0
            ? `${players.length} here — ${needed} more player${needed === 1 ? '' : 's'} to start`
            : 'starting shortly...'
        }
      />
      <PlayerStrip />
      <BigButton label="Play a round solo" onClick={() => startDemo()} />
      <Caption text={needed > 0 ? 'see how it works while you wait' : ' '} />
    </Card>
  )
}

/**
 * The solo walkthrough, built from the same components a real round uses — a
 * visitor should be learning the actual interface, not a diagram of it.
 */
function DemoScreen() {
  switch (demoPhaseNow()) {
    case DemoPhase.Pick:
      return <DemoPickScreen />
    case DemoPhase.Act:
      return <DemoActScreen />
    case DemoPhase.Reveal:
      return <DemoRevealScreen />
    default:
      return <Connecting />
  }
}

function DemoPickScreen() {
  const picked = demoChoice()
  return (
    <Card>
      <Caption text="SOLO ROUND — pick one you can mime" color={C.amber} />
      <TimerBar remaining01={demoRemaining01()} color={C.amber} />
      <OptionGrid
        ids={demoOptionIds()}
        toneFor={(id) => (picked === id ? 'selected' : 'idle')}
        onPick={(id) => commitDemoChoice(id)}
      />
    </Card>
  )
}

function DemoActScreen() {
  const prompt = PROMPTS_BY_ID[demoChoice()]
  return (
    <Card>
      <Caption text={`ACT IT OUT — ${demoSecondsLeft()}s`} color={C.amber} />
      <Title text={prompt?.text ?? '...'} color={C.mint} />
      <TimerBar remaining01={demoRemaining01()} color={C.amber} />
      <Caption text="tap emotes to act it out — the mint ones read best for this" />
      <EmoteWheel suggestIds={prompt?.suggests ?? []} />
    </Card>
  )
}

function DemoRevealScreen() {
  const prompt = PROMPTS_BY_ID[demoChoice()]
  return (
    <Card>
      <Caption text="THAT WAS A ROUND — WITHOUT THE BEST PART" color={C.amber} />
      <Title text={prompt?.text ?? '...'} color={C.mint} />
      <Caption text="you just mimed that. with people here, they'd have been" />
      <Caption text="watching you and picking from the same four options" />
      <Caption text="you score for every one who reads you right" color={C.mint} />
      <Row2>
        <BigButton label="Again" tone="muted" width="48%" onClick={() => startDemo()} />
        <BigButton label="Done" width="48%" onClick={() => endDemo()} />
      </Row2>
    </Card>
  )
}

function CountdownScreen(props: { title: string; caption: string }) {
  return (
    <Card>
      <Title text={props.title} />
      <Caption text={props.caption} />
      <TimerBar remaining01={phaseRemaining01()} color={C.amber} />
      <ScoreStrip />
    </Card>
  )
}

function WaitingScreen(props: { caption: string }) {
  const m = currentMatch()
  const actorName = m ? nameOf(m.actorId) : '...'
  return (
    <Card>
      <Title text={`${actorName} is on stage`} />
      <Caption text={props.caption} />
      <TimerBar remaining01={phaseRemaining01()} color={C.amber} />
    </Card>
  )
}

function ActorPickScreen() {
  const m = currentMatch()
  if (m === null) return <Connecting />
  const picked = myChoice(m.roundIndex)
  const onStage = isOnStage(myUserId())

  return (
    <Card>
      <Caption text={pickCaption(onStage, picked !== '')} color={onStage ? C.dim : C.amber} />
      <TimerBar remaining01={phaseRemaining01()} color={onStage ? C.hot : C.amber} />
      <OptionGrid
        ids={optionIds()}
        toneFor={(id) => (picked === id ? 'selected' : 'idle')}
        onPick={(id) => commitChoice(id)}
      />
    </Card>
  )
}

function ActorActScreen() {
  const m = currentMatch()
  if (m === null) return <Connecting />
  const choiceId = myChoice(m.roundIndex)
  const prompt = PROMPTS_BY_ID[choiceId]

  return (
    <Card>
      <Caption text={`ACT IT OUT — ${secondsLeft()}s`} />
      <Title text={prompt?.text ?? '...'} color={C.mint} />
      <TimerBar remaining01={phaseRemaining01()} color={C.hot} />
      <Caption text="tap emotes — the others are guessing which one you mean" />
      <EmoteWheel suggestIds={prompt?.suggests ?? []} />
    </Card>
  )
}

function GuessScreen() {
  const m = currentMatch()
  if (m === null) return <Connecting />
  const guess = myGuess(m.roundIndex)
  const locked = guess !== ''

  return (
    <Card>
      <Caption
        text={
          locked
            ? `locked in — ${PROMPTS_BY_ID[guess]?.text ?? '...'}`
            : `what is ${nameOf(m.actorId)} doing? ${secondsLeft()}s`
        }
        color={locked ? C.mint : C.dim}
      />
      <TimerBar remaining01={phaseRemaining01()} color={locked ? C.mint : C.hot} />
      {/* Once the answer is locked it cannot be changed, so the buttons have
          nothing left to do — and this is exactly the moment the guesser should
          be watching the performance. They go away and the screen clears. */}
      {locked ? (
        <Caption text="watch the rest of the performance" />
      ) : (
        <OptionGrid
          ids={optionIds()}
          toneFor={() => 'idle'}
          onPick={(id) => commitGuess(id)}
        />
      )}
    </Card>
  )
}

function RevealScreen() {
  const m = currentMatch()
  if (m === null) return <Connecting />

  if (m.answerId === '') {
    return (
      <Card>
        <Title text="Round voided" color={C.bad} />
        <Caption text={voidReason(m.actorId)} />
        <ScoreStrip />
      </Card>
    )
  }

  const answer = PROMPTS_BY_ID[m.answerId]
  const myRow = findScore(scoreRows(), myUserId())
  const gained = myRow?.lastGained ?? 0
  const guessedRight = !amActor() && myGuess(m.roundIndex) === m.answerId

  // Count votes per option to show how many guessers picked each answer
  const votes = getVotesForRound(m.actorId, m.roundIndex)

  return (
    <Card>
      <Title text={answer?.text ?? m.answerId} color={C.mint} />
      <Caption text={revealLine(m.actorId, m.roundIndex, m.answerId, gained)} color={revealColour(guessedRight)} />
      <OptionGrid
        ids={optionIds()}
        toneFor={(id) => {
          if (id === m.answerId) return 'correct'
          if (!amActor() && myGuess(m.roundIndex) === id) return 'wrong'
          return 'muted'
        }}
        badgeFor={(id) => ((votes[id] ?? 0) > 0 ? `${votes[id]}` : undefined)}
        disabled
        onPick={() => {}}
      />
      <ScoreStrip />
    </Card>
  )
}

function MatchEndScreen() {
  const rows = ranked(scoreRows())
  const winner = rows.length > 0 ? nameOf(rows[0].userId) : '—'
  return (
    <Card>
      <Caption text="MATCH OVER" />
      <Title text={`${winner} wins`} color={C.amber} />
      <ScoreStrip full />
      <Caption text={`tomorrow's theme — ${PACK_NAMES[packForDay(1)]}`} color={C.mint} />
      <Caption text="new match starting..." />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * The emote palette. 16 tiles, four per row — each tile is a single tap that
 * fires a base emote on the local avatar. This is the only "skill" input in
 * the game, and it has no timing window on purpose.
 *
 * `suggestIds` — when provided, those tiles get a highlighted border so the
 * actor sees which emotes work well for the active prompt.
 */
function EmoteWheel(props: { suggestIds?: string[] } = {}) {
  const { touch } = canvas()
  const tile = touch ? '23.5%' : '11.5%'
  const suggested = new Set(props.suggestIds ?? [])
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        margin: { top: px(8) }
      }}
    >
      {EMOTES.map((e) => {
        const isSuggested = suggested.has(e.id)
        return (
          <UiEntity
            key={e.id}
            uiTransform={{
              width: tile,
              height: tapHeight(),
              margin: { top: px(4), bottom: px(4) },
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: px(12),
              borderWidth: isSuggested ? px(2) : px(1),
              borderColor: isSuggested ? C.mint : C.line,
              pointerFilter: 'block'
            }}
            uiBackground={{ color: isSuggested ? Color4.create(C.mint.r, C.mint.g, C.mint.b, 0.12) : C.panelSolid }}
            onMouseDown={() => playEmote(e.id)}
          >
            <Label
              value={`${e.glyph}\n${e.label}`}
              fontSize={fs(13)}
              color={isSuggested ? C.mint : C.text}
              textAlign="middle-center"
              uiTransform={{ width: '100%', height: '100%' }}
            />
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}

/** Compact live standings; `full` shows everyone instead of the top few. */
function ScoreStrip(props: { full?: boolean } = {}) {
  const rows = ranked(scoreRows())
  if (rows.length === 0) return <UiEntity uiTransform={{ width: '100%', height: 0 }} />

  const visible = props.full === true ? rows : rows.slice(0, 4)
  const me = myUserId().toLowerCase()

  return (
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', margin: { top: px(10) } }}>
      {visible.map((r, i) => {
        const mine = r.userId.toLowerCase() === me
        return (
          <UiEntity
            key={r.userId}
            uiTransform={{
              width: '100%',
              height: fs(30),
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: { left: px(10), right: px(10) },
              borderRadius: px(8)
            }}
            uiBackground={{ color: mine ? Color4.create(C.hot.r, C.hot.g, C.hot.b, 0.18) : C.clear }}
          >
            <Label
              value={`${i + 1}.  ${nameOf(r.userId)}`}
              fontSize={fs(16)}
              color={mine ? C.text : C.dim}
              textAlign="middle-left"
              uiTransform={{ width: '70%', height: '100%' }}
            />
            <Label
              value={r.lastGained > 0 ? `${r.score}  <color=#7cf6d4>+${r.lastGained}</color>` : `${r.score}`}
              fontSize={fs(16)}
              color={C.text}
              textAlign="middle-right"
              uiTransform={{ width: '30%', height: '100%' }}
            />
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}

/** Avatar faces of everyone in the room — cheap proof that this is multiplayer. */
function PlayerStrip() {
  const players = roster().slice(0, 8)
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: px(56),
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        margin: { top: px(8), bottom: px(8) }
      }}
    >
      {players.map((p) => (
        <UiEntity
          key={p.userId}
          uiTransform={{
            width: px(48),
            height: px(48),
            margin: { left: px(4), right: px(4) },
            borderRadius: px(24),
            borderWidth: px(2),
            borderColor: C.line
          }}
          uiBackground={{ avatarTexture: { userId: p.userId } }}
        />
      ))}
    </UiEntity>
  )
}

/**
 * Four prompt options as a 2x2 grid rather than a stack.
 *
 * Stacked, they ate two thirds of a landscape phone screen — and in a game
 * about watching someone mime, the thing they covered was the performer. Two
 * rows of two halves that, and the options are still wide enough for the
 * longest prompt in the library.
 */
function OptionGrid(props: {
  ids: string[]
  toneFor: (id: string) => 'idle' | 'selected' | 'correct' | 'wrong' | 'muted'
  badgeFor?: (id: string) => string | undefined
  disabled?: boolean
  onPick: (id: string) => void
}) {
  const rows = [props.ids.slice(0, 2), props.ids.slice(2, 4)]
  return (
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'column' }}>
      {rows.map((row) => (
        <Row2>
          {row.map((id) => (
            <BigButton
              key={id}
              label={PROMPTS_BY_ID[id]?.text ?? id}
              tone={props.toneFor(id)}
              badge={props.badgeFor ? props.badgeFor(id) : undefined}
              width="48.5%"
              disabled={props.disabled}
              onClick={() => props.onPick(id)}
            />
          ))}
        </Row2>
      ))}
    </UiEntity>
  )
}

function Row2(props: { children?: unknown }) {
  return (
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between' }}>
      {props.children}
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nameOf(userId: string): string {
  if (userId === '') return '—'
  const target = userId.toLowerCase()
  for (const p of roster()) {
    if (p.userId.toLowerCase() === target) return p.name
  }
  // They have left, but their score is still on the board — use the name we
  // saw while they were here rather than showing a wallet address.
  return nameFor(userId) ?? `${userId.slice(0, 6)}…`
}

/**
 * The actor's one line of instruction. Getting onto the stage holds the round
 * back for as long as the pick timer runs, so it outranks anything else we
 * could say here — but it will not block a committed actor forever.
 */
function pickCaption(onStage: boolean, hasPicked: boolean): string {
  if (onStage) return 'YOUR TURN — pick the one you can mime'
  return hasPicked ? 'NOW STEP ONTO THE PINK STAGE' : 'STEP ONTO THE PINK STAGE, THEN PICK'
}

/** Why the round died — the actor walking out and the actor going quiet look
 *  identical on the wire, so we tell them apart by who is still in the room. */
/**
 * The one line that carries the round's outcome.
 *
 * Names beat numbers here. Being told "dendon read you" is a social event;
 * being shown a vote count is a report. Both cost the same to render.
 */
function revealLine(actorId: string, roundIndex: number, answerId: string, gained: number): string {
  const readers = readersOf(actorId, roundIndex, answerId)
  const guessers = Math.max(0, roster().length - 1)

  if (amActor()) {
    if (readers.length === 0) return `nobody read you  +${gained}`
    if (readers.length === 1) return `${nameOf(readers[0])} read you  +${gained}`
    return `${readers.length} of ${guessers} read you  +${gained}`
  }

  const iGotIt = readers.some((id) => id.toLowerCase() === myUserId().toLowerCase())
  if (iGotIt) return `you read ${nameOf(actorId)}  +${gained}`
  return readers.length > 0 ? `not this time — ${readers.length} of ${guessers} got it` : 'nobody got that one'
}

function revealColour(guessedRight: boolean): Color4 {
  if (amActor()) return C.amber
  return guessedRight ? C.mint : C.dim
}

function voidReason(actorId: string): string {
  const players = roster()
  // Checked first: when the room empties out, "the actor didn't choose" is not
  // just unhelpful, it is wrong — the actor may be the one person left reading
  // this, having picked a prompt perfectly well.
  if (players.length < RULES.minPlayers) return 'not enough players to finish the round'

  const target = actorId.toLowerCase()
  for (const p of players) {
    if (p.userId.toLowerCase() === target) return "the actor didn't choose a prompt"
  }
  return 'the actor left the room'
}

function nextUpCaption(): string {
  const m = currentMatch()
  if (m === null) return ''
  const remaining = RULES.roundsPerMatch - (m.roundIndex + 1)
  return remaining > 0 ? `${remaining} round${remaining === 1 ? '' : 's'} left` : 'final scores coming up'
}
