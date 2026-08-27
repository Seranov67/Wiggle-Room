/**
 * A room of simulated clients, driven frame by frame.
 *
 * Each client gets its own copy of the `src` graph — its own module-level host
 * state, its own local clock — while sharing one world. That is the shape of a
 * real room, and it is what makes host handover testable at all: two clients
 * genuinely disagreeing is the thing that goes wrong, and one shared module
 * instance could never disagree with itself.
 */
import { world } from './world.ts'
import { parseScores, type ScoreRow } from '../../src/game/scoreboard.ts'

/**
 * One untagged copy of the components, so a test can read the match without
 * going through a particular client. Every tagged copy resolves to the same
 * definitions, because the world keys them by name.
 */
const ref = await import('../../src/game/components.ts?w=ref')
export const Match = ref.Match
export const Wiggler = ref.Wiggler
export const Phase = ref.Phase

const PHASE_NAMES = Object.fromEntries(Object.entries(Phase).map(([name, value]) => [value, name]))

let nextTag = 0

export type Client = {
  userId: string
  name: string
  machine: Record<string, any>
  net: Record<string, any>
  /** One frame for this client. Mirrors `gameSystem` in `src/index.ts`. */
  tick(dtSeconds: number): void
}

async function spawnClient(userId: string, name: string): Promise<Client> {
  const tag = `c${++nextTag}`
  const machine = await import(`../../src/game/machine.ts?w=${tag}`)
  const net = await import(`../../src/game/net.ts?w=${tag}`)

  world.currentActor = userId
  net.initNet()

  return {
    userId,
    name,
    machine,
    net,
    tick(dtSeconds: number): void {
      world.currentActor = userId
      net.refreshSelfIdentity()
      net.invalidateRoster()
      machine.localTick(dtSeconds)
      machine.hostTick(dtSeconds)
    }
  }
}

export type Room = ReturnType<typeof createRoom>

export function createRoom() {
  world.reset()

  const clients: Client[] = []
  const names = new Map<string, string>()
  /** Clients whose scene has stopped running while their avatar stays in the room. */
  const frozen = new Set<string>()

  const find = (userId: string): Client => {
    const c = clients.find((x) => x.userId.toLowerCase() === userId.toLowerCase())
    if (!c) throw new Error(`no active client for ${userId}`)
    return c
  }

  /** Run whichever client is currently the acting one, for a read-only call. */
  const asClient = <T>(userId: string, fn: (c: Client) => T): T => {
    const c = find(userId)
    world.currentActor = userId
    c.net.invalidateRoster()
    return fn(c)
  }

  const room = {
    clients,

    /** A player loads the scene. */
    async join(userId: string, name: string): Promise<Client> {
      world.join(userId, name)
      names.set(userId.toLowerCase(), name)
      const client = await spawnClient(userId, name)
      clients.push(client)
      return client
    },

    /** A player closes the tab: presence gone, and their client stops running. */
    disconnect(userId: string): void {
      world.leave(userId)
      const i = clients.findIndex((c) => c.userId.toLowerCase() === userId.toLowerCase())
      if (i >= 0) clients.splice(i, 1)
    },

    /**
     * A sync hiccup: the player drops out of everyone else's roster for a
     * moment while their client keeps running. This is what `ROSTER_GRACE_MS`
     * exists to absorb.
     */
    flicker(userId: string): void {
      world.leave(userId)
    },

    /** The hiccup passes and the roster heals. */
    restore(userId: string): void {
      world.join(userId, names.get(userId.toLowerCase()) ?? 'Anon')
    },

    /**
     * The client stops running but its avatar stays put — a scene that died
     * behind a player who is still, as far as everyone else can see, right
     * here. This is the case `HOST_STALL_GRACE_MS` exists for, and the one
     * `isPresent` cannot detect on its own.
     */
    freeze(userId: string): void {
      frozen.add(userId.toLowerCase())
    },

    thaw(userId: string): void {
      frozen.delete(userId.toLowerCase())
    },

    /**
     * Rewrite the match as a different build of the scene would have left it.
     * Nothing else can produce this state: our clients only ever write their
     * own `PROTOCOL_VERSION`.
     */
    forceProtocol(protocol: number, hostId?: string): void {
      if (clients.length === 0) throw new Error('no clients to reach the match through')
      const m = Match.getMutable(clients[0].net.getMatchEntity()) as Record<string, unknown>
      m.protocol = protocol
      if (hostId !== undefined) m.hostId = hostId
    },

    /** One frame for every client still running. */
    tick(dtSeconds: number): void {
      for (const client of [...clients]) {
        if (!frozen.has(client.userId.toLowerCase())) client.tick(dtSeconds)
      }
    },

    /** Run `ms` of wall time in `stepMs` frames. */
    advance(ms: number, stepMs = 100): void {
      let left = ms
      while (left > 0) {
        const step = Math.min(stepMs, left)
        room.tick(step / 1000)
        left -= step
      }
    },

    /** A few frames with no time passing worth mentioning, to let identities resolve. */
    settle(frames = 3): void {
      for (let i = 0; i < frames; i++) room.tick(0.016)
    },

    // -- input ------------------------------------------------------------

    choose(userId: string, promptId: string): void {
      asClient(userId, (c) => c.machine.commitChoice(promptId))
    },

    guess(userId: string, promptId: string): void {
      asClient(userId, (c) => c.machine.commitGuess(promptId))
    },

    // -- reading the match --------------------------------------------------

    match(): Record<string, any> | null {
      if (clients.length === 0) return null
      return Match.getOrNull(clients[0].net.getMatchEntity()) as Record<string, any> | null
    },

    phase(): number {
      return (room.match()?.phase as number) ?? -1
    },

    phaseName(): string {
      return PHASE_NAMES[room.phase()] ?? `unknown(${room.phase()})`
    },

    actorId(): string {
      return (room.match()?.actorId as string) ?? ''
    },

    hostId(): string {
      return (room.match()?.hostId as string) ?? ''
    },

    protocol(): number {
      return (room.match()?.protocol as number) ?? -1
    },

    /** Bumped on every phase entry; a frozen token means nothing is advancing. */
    phaseToken(): number {
      return (room.match()?.phaseToken as number) ?? -1
    },

    options(): string[] {
      const ids = (room.match()?.optionIds as string) ?? ''
      return ids === '' ? [] : ids.split(',')
    },

    answerId(): string {
      return (room.match()?.answerId as string) ?? ''
    },

    roundIndex(): number {
      return (room.match()?.roundIndex as number) ?? -1
    },

    scores(): ScoreRow[] {
      return parseScores((room.match()?.scores as string) ?? '')
    },

    scoreOf(userId: string): number {
      return room.scores().find((r) => r.userId.toLowerCase() === userId.toLowerCase())?.score ?? 0
    },

    /** The one option this round that is not the answer, for a wrong guess. */
    wrongOption(answerId: string): string {
      const wrong = room.options().find((id) => id !== answerId)
      if (!wrong) throw new Error('no options to be wrong about')
      return wrong
    }
  }

  return room
}
