import ReactEcs, { Label, ReactEcsRenderer, ScreenInsetArea, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { C, canvas, fs, px, tapHeight } from './theme'
import { BigButton, Caption, Card, TimerBar, Title } from './widgets'
import { Phase } from '../game/components'
import {
  amActor,
  commitChoice,
  commitGuess,
  currentMatch,
  endPractice,
  getVotesForRound,
  isOnStage,
  myChoice,
  myGuess,
  optionIds,
  phaseRemaining01,
  practicePrompt,
  protocolOk,
  rollPracticePrompt,
  scoreRows,
  secondsLeft
} from '../game/machine'
import { PROMPTS_BY_ID } from '../game/prompts'
import { EMOTES, playEmote } from '../game/emotes'
import { isHost, myUserId, networkReady, roster } from '../game/net'
import { ranked, findScore } from '../game/scoreboard'
import { RULES } from '../config'

export function setupUi(): void {
  ReactEcsRenderer.setUiRenderer(() => <Root />)
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
  const { portrait, width } = canvas()
  const sheetWidth = Math.min(width - px(24), portrait ? width - px(24) : 860)

  return (
    <ScreenInsetArea
      uiTransform={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'center'
      }}
    >
      <UiEntity
        uiTransform={{
          width: sheetWidth,
          flexDirection: 'column',
          alignItems: 'center',
          margin: { bottom: px(18) }
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
  if (practicePrompt() !== '') return <PracticeScreen />

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
      <Caption
        text={
          needed > 0
            ? `${players.length} here — ${needed} more player${needed === 1 ? '' : 's'} to start`
            : 'starting shortly...'
        }
      />
      <PlayerStrip />
      <BigButton
        label="Practice your emotes"
        tone="muted"
        onClick={() => rollPracticePrompt()}
      />
      <Caption text={isHost() ? 'you are hosting this room' : ' '} />
    </Card>
  )
}

function PracticeScreen() {
  const prompt = PROMPTS_BY_ID[practicePrompt()]
  return (
    <Card>
      <Caption text="PRACTICE — nobody is scoring you" />
      <Title text={prompt?.text ?? '...'} color={C.mint} />
      <EmoteWheel />
      <Row2>
        <BigButton label="New prompt" tone="muted" width="48%" onClick={() => rollPracticePrompt()} />
        <BigButton label="Done" width="48%" onClick={() => endPractice()} />
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
      {optionIds().map((id) => (
        <BigButton
          key={id}
          label={PROMPTS_BY_ID[id]?.text ?? id}
          tone={picked === id ? 'selected' : 'idle'}
          onClick={() => commitChoice(id)}
        />
      ))}
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
      <Caption text={locked ? 'locked in — watch the others' : `what is ${nameOf(m.actorId)} doing? ${secondsLeft()}s`} />
      <TimerBar remaining01={phaseRemaining01()} color={locked ? C.mint : C.hot} />
      {optionIds().map((id) => (
        <BigButton
          key={id}
          label={PROMPTS_BY_ID[id]?.text ?? id}
          tone={locked ? (guess === id ? 'selected' : 'muted') : 'idle'}
          disabled={locked}
          onClick={() => commitGuess(id)}
        />
      ))}
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
      <Caption text="it was" />
      <Title text={answer?.text ?? m.answerId} color={C.mint} />
      <Caption
        text={amActor() ? `+${gained} for the performance` : guessedRight ? `correct  +${gained}` : 'not this time'}
        color={amActor() ? C.amber : guessedRight ? C.mint : C.dim}
      />
      {optionIds().map((id) => {
        const isAnswer = id === m.answerId
        const myPick = !amActor() && myGuess(m.roundIndex) === id
        let tone: 'correct' | 'wrong' | 'muted' | 'idle' = 'muted'
        if (isAnswer) tone = 'correct'
        else if (myPick) tone = 'wrong'
        const count = votes[id] ?? 0
        return (
          <BigButton
            key={id}
            label={PROMPTS_BY_ID[id]?.text ?? id}
            tone={tone}
            onClick={() => {}}
            badge={count > 0 ? `${count} voted` : undefined}
          />
        )
      })}
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
  return `${userId.slice(0, 6)}…`
}

function nextUpCaption(): string {
  const m = currentMatch()
  if (m === null) return ''
  const remaining = RULES.roundsPerMatch - (m.roundIndex + 1)
  return remaining > 0 ? `${remaining} round${remaining === 1 ? '' : 's'} left` : 'final scores coming up'
}
