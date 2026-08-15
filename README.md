# Wiggle Room

**Emote charades in Decentraland.** One player gets a secret prompt and acts it out using
nothing but their avatar's built-in emotes. Everyone else picks what they think it was.
No typing, no voice required, no wearables to buy — just vibes.

Built with Decentraland SDK7, mobile-first.

> **Play it:** _TODO — deployed World URL_
> **Source:** https://github.com/Seranov67/Wiggle-Room

---

## How a round plays

| Phase | Length | What happens |
| --- | --- | --- |
| **Lobby** | — | Waiting for a second player. Alone? Play a round solo to see how it works. |
| **Starting** | 8s | Enough players joined. Everyone gets ready. |
| **Pick** | 12s | The actor sees 4 prompts and picks one — and steps onto the pink stage. |
| **Act** | 45s | The actor mimes it. Guessers lock in one of the same 4 options, whenever they're ready. |
| **Reveal** | 9s | The answer, who voted for what, and the points. |
| **Intermission** | 4s | Breather. The stage passes to the next player. |

Eight rounds make a match, then the final scoreboard and a fresh start. Everyone takes a
turn on stage — the actor rotates through the room in a fixed order, so nobody spectates
all night.

**Arriving first doesn't mean waiting around.** A lone visitor can play a round solo on a
shortened clock — pick a prompt, mime it under the spotlight, then read what would have
happened. It uses the same screens a real round does, so you learn the actual interface
rather than a tutorial about it, and it steps aside the moment a second player shows up.

### Scoring

- **Correct guess:** 100 points, plus up to 100 more for guessing early — the speed bonus
  decays linearly across the act phase.
- **Streaks:** consecutive correct guesses multiply at 1× → 1.25× → 1.5×.
- **The actor** earns 60 per player who guessed right, with a floor of 10. Being
  expressive pays better than being cryptic.

## Why mobile-first

Decentraland on a phone is a different game to Decentraland on a desktop, and most party
games ported there assume a keyboard. Wiggle Room is built the other way round:

- **No typing.** Every input in the game is a single tap. The one "skill" input — firing
  an emote — has no timing window at all.
- **Everything lives in the bottom third.** The UI is one bottom sheet, because that's the
  only region a thumb reaches while the top of the screen shows the avatars.
- **Big targets.** Primary buttons land at 59pt on any touch-width screen — comfortably
  above the 44–48pt minimum Apple and Google both recommend. The emote grid is 4 columns
  on touch, 8 on desktop.
- **One scale factor.** Type and spacing derive from a single canvas-width scale with a
  hard floor, so a 375pt phone and a 2560px monitor share one layout.
- **Interactive in about a second.** The arena is built entirely from ECS primitives —
  there is not a single GLB to download before you can play.

## Running it locally

```bash
npm install
```

```bash
npm run start
```

Then open the preview URL it prints. To type-check and bundle without launching:

```bash
npm run build
```

Deploying to a World requires a `worldConfiguration` block in
[`scene.json`](scene.json) naming the World you own:

```json
"worldConfiguration": { "name": "your-name.dcl.eth" }
```

Then:

```bash
npm run deploy -- --target-content https://worlds-content-server.decentraland.org
```

## How it works

The whole game runs off one system in [`src/index.ts`](src/index.ts), which calls
`hostTick` (authority) and `localTick` (this client's own clock) every frame.

**One host, elected without a handshake.** The client with the lowest userId in the room
runs the state machine; everyone else treats the match as read-only. Because every client
computes the same election from the same data, there is no handover message to lose — when
the host walks out, the next client picks the match up on its very next frame.

**Two synced components** ([`src/game/components.ts`](src/game/components.ts)):

- `Match` — phase, actor, options, answer, scores. Written **only** by the host, so there
  are no last-write-wins races over the scoreboard.
- `Wiggler` — one per player, written only by that player: their pick, their guess, and
  how far into the act phase they locked it in.

**No clock synchronisation.** The host bumps a `phaseToken` on every phase entry; clients
restart their own countdown when it changes. Nobody has to agree on wall-clock time.

**Rounds fail safe.** An actor who never picks, walks out mid-performance, or leaves a
two-player room voids the round *through* the reveal screen, so players are told why it
ended instead of being dropped into an unexplained intermission.

**Protocol versioning.** `Match.protocol` is checked, not just written. A client running
an older build of the scene shows an "out of date" card rather than corrupting a match it
cannot read — and a match orphaned by a newer build is reclaimed once its host leaves, so
a mixed-version room can never brick permanently.

### Layout

```
src/
  index.ts            entry point; one system drives everything
  config.ts           every tunable number — timings, scoring, rules, arena
  game/
    components.ts     synced ECS components + phase enum
    net.ts            sync, host election, roster
    machine.ts        the match state machine
    prompts.ts        42 prompts in 4 packs + deterministic RNG
    scoreboard.ts     scoreboard serialisation
    emotes.ts         the 16 base emotes
  scene/arena.ts      stage, seating, status backdrop, actor spotlight
  ui/                 bottom sheet, widgets, theme
```

Adding a prompt has one rule: it must be actable with the base emote set plus walking and
jumping. If you can't mime it in three emotes, it doesn't belong.

## Mobile QA

Status: **not yet run.** Results go in this table once tested on device.

| Check | Result |
| --- | --- |
| 2 players — full match end to end | ☐ |
| 3 players | ☐ |
| 4 players | ☐ |
| Actor disconnects during Pick | ☐ |
| Actor disconnects during Act | ☐ |
| Guesser disconnects mid-round | ☐ |
| Host leaves mid-match (handover) | ☐ |
| Two-player room: actor leaves → void → lobby | ☐ |
| Reconnect after backgrounding the app | ☐ |
| Portrait 360×640 — no clipping | ☐ |
| Portrait 390×844 — no clipping | ☐ |
| 16-emote grid fits with prompt + timer above it | ☐ |
| Landscape | ☐ |
| Desktop 1280×800 | ☐ |
| Remote actor position visible to the host (stage gate) | ☐ |
| Frame rate during a 4-player act phase | ☐ |

## Tech

Decentraland SDK7 · TypeScript · `@dcl/sdk/react-ecs` for UI · `@dcl/sdk/network` for
state sync. One parcel, no external assets.

## License

MIT — see [LICENSE](LICENSE).
