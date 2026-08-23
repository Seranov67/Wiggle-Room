# Wiggle Room

**Emote charades in Decentraland.** One player gets a secret prompt and acts it out using
nothing but their avatar's built-in emotes. Everyone else picks what they think it was.
No typing, no voice required, no wearables to buy — just vibes.

Built with Decentraland SDK7, mobile-first.

> **Play it:** https://decentraland.org/jump/?realm=castlerock.dcl.eth
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

**A different theme every day.** One of the four prompt packs is featured each day, and
the match-end screen tells you which one is up tomorrow. The rotation is keyed to the UTC
day number, so every player everywhere sees the same theme with no server, no database
and no stored state — and tomorrow is reliably not today.

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
- **The interface stays out of the way.** It is one sheet along the bottom, and on the
  mobile client — which runs landscape — it sits against the left edge and stops short of
  the middle. That is not a style choice: the client paints its own movement and action
  buttons over the screen edges, and puts your avatar dead centre, so a sheet sized for a
  desktop covers both the controls and the performance you are meant to be watching.
- **The emote wheel is a palette, not a row of buttons.** Twenty emotes, ten across on a
  wide screen and five when it is narrow, on tiles shorter than a tap target needs to be
  for something you press once. On a landscape phone the scarce axis is height, and every
  pixel the wheel gives back is a pixel the performance keeps.
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

Then open the preview URL it prints. Add `-- --mobile` for a QR code you can scan from
a phone on the same network, or `-- --multi-instance` to run several Explorers at once
and test the multiplayer.

To run the unit tests, and to type-check and bundle:

```bash
npm test
```

```bash
npm run build
```

Deploying to a World requires a `worldConfiguration` block in
[`scene.json`](scene.json) naming a World you own or hold collaborator rights to:

```json
"worldConfiguration": { "name": "your-name.dcl.eth" }
```

Then:

```bash
npm run deploy:world
```

The content server is baked into that script deliberately. Passed as a flag
(`npm run deploy -- --target-content …`) the argument is swallowed under PowerShell,
and the deploy then refuses to run against a scene whose scene.json names a World.

If the CLI’s signing step fails, publish from the **Decentraland Creator Hub**
instead (Publish → Publish to World). It signs through a different path, and it does
list Worlds you only hold collaborator rights to — which the CLI does not.

## How it works

The whole game runs off one system in [`src/index.ts`](src/index.ts), which calls
`hostTick` (authority) and `localTick` (this client's own clock) every frame.

**One client runs the match, and presence decides which.** Whoever the match names as
its host keeps it for as long as they are still in the room. An election — lowest
userId wins — only decides who *claims* a match nobody is running, which is what
happens when the previous host walks out. There is no handover message to lose, because
every client computes the same election from the same data.

It is deliberately not the other way round. Taking the match from whoever the election
currently favours sounds tidier, but rosters do not converge instantly: for a second
after someone joins, two clients can each believe they are elected, and since adopting
a match restarts the phase for everyone, they would reset the countdown every frame
between them. A host that has actually gone is relieved immediately; one that is still
here but has plainly stopped advancing is relieved after a generous grace.

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
    scoring.ts        streak and speed-bonus curves, import-free so tests can load them
    scoreboard.ts     scoreboard serialisation
    emotes.ts         20 emotes — 16 expressive, 4 that mime an action
  scene/arena.ts      stage, seating, status backdrop, actor spotlight
  ui/                 bottom sheet, widgets, theme
```

`test/` sits outside the tsconfig `include` and imports source with explicit `.ts`
extensions, because Node resolves those files directly rather than through the bundler.

Adding a prompt has one rule: it must be actable with the base emote set plus walking and
jumping. If you can't mime it in three emotes, it doesn't belong.

## Mobile QA

Tested on an Android phone in the Decentraland mobile app and on the desktop client.
**The mobile client runs landscape**, at 1280x576 — the opposite shape to the tall
narrow screen a phone UI is usually designed for, and it changed several layout
decisions.

| Check | Result |
| --- | --- |
| Scene loads and the arena renders | ✅ |
| Solo round end to end — pick, act, reveal | ✅ |
| **Avatar performs the emote when tapped** | ✅ |
| **Other players see the performance** | ✅ |
| Two players join, match starts on its own | ✅ |
| Actor and guesser get the right screens | ✅ |
| Reveal shows the answer, the votes and the points | ✅ |
| Emote suggestions highlight the right ones | ✅ verified against four prompts |
| Status board readable from inside the arena | ✅ |
| Actor visible while performing | ✅ after moving the spotlight to the floor |
| Sheet clears the client’s own buttons | ✅ |
| Frame rate while moving | 38–52 fps on the phone, no stutter on desktop |
| Full eight-round match to the final scoreboard | ☐ |
| Actor rotates every round | ☐ |
| Actor disconnects during Pick | ☐ |
| Actor disconnects during Act | ☐ |
| Guesser disconnects mid-round | ☐ |
| Host leaves mid-match (handover) | ☐ |
| Two-player room: actor leaves → void → lobby | ☐ |
| Reconnect after backgrounding the app | ☐ |

The core loop is verified end to end with two players on separate accounts. What
remains unchecked is how it behaves when somebody leaves mid-round.

## Tech

Decentraland SDK7 · TypeScript · `@dcl/sdk/react-ecs` for UI · `@dcl/sdk/network` for
state sync. One parcel, no external assets.

## License

MIT — see [LICENSE](LICENSE).
