# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Wiggle Room** — emote charades for Decentraland SDK7. One player mimes a secret prompt
with their avatar's built-in emotes; everyone else picks what it was from four options.
One parcel, mobile-first, no 3D assets.

Built for the Friendzone Buildathon (organiser: DCL Regenesis Labs). It is deployed and
live — see [Deployment](#deployment).

Decentraland SDK skills are installed under `.claude/skills/` (git-ignored). If they are
missing, reinstall with `npx skills add decentraland/sdk-skills --all`. `deploy-worlds`,
`multiplayer-sync`, `build-ui` and `optimize-scene` are the relevant ones here.

## Commands

```bash
npm run build          # bundle + type check
npm test               # 42 unit tests, node:test with type stripping
npm run start          # local preview
npm run start -- --mobile           # preview + QR for a phone on the same network
npm run start -- --multi-instance   # several Explorers at once, for multiplayer testing
npm run deploy:world   # publish to the World named in scene.json
```

Run one test file: `node --experimental-strip-types --test "test/scoring.test.ts"`.

Tests import source with an explicit `.ts` extension (`../src/game/scoring.ts`) because
Node resolves them directly. `test/` is outside the tsconfig `include`, so this does not
conflict with the scene's own extensionless imports.

## Architecture

The whole game runs from one system registered in `src/index.ts`, which calls `hostTick`
(authority) and `localTick` (this client's clock) each frame. `src/scene/arena.ts` adds
two more systems for the spotlight and the status board.

**One host, no handshake.** Exactly one client runs the state machine; everyone else
renders `Match` read-only. Which client that is comes from the rule below, not from the
election alone — and no handover message exists to be lost, because every client derives
the answer from data it already has.

**Two synced components** (`src/game/components.ts`):

- `Match` — phase, actor, options, answer, scores. Written **only** by the host, which is
  why the scoreboard has no last-write-wins races.
- `Wiggler` — one per player, written only by that player.

**No clock synchronisation.** The host bumps `phaseToken` on every phase entry and
clients restart their own countdown when it changes.

**Authority is judged by presence, never by election.** Whoever `Match.hostId` names
keeps the match while they are still in the room (`isPresent()`, which reads
`PlayerIdentityData`, not our own components — it stays truthful across protocol
versions). The election only decides who *claims* a match nobody is running. This is not
a style preference: adopting bumps `phaseToken`, and during the second or two where two
clients each believe they are elected, election-based handover resets everyone's
countdown every frame and the phase stops advancing entirely.

**The lobby is a legitimate resting state.** It has no duration and never bumps
`phaseToken`, so a frozen token proves nothing about liveness. Two places had to learn
this (`reconcileProtocol`, `takeOverFrom`) — do not add a third that treats a quiet lobby
as a dead host.

**Rounds fail safe.** An actor who never picks, walks out, or leaves a two-player room
voids the round *through* `Phase.Reveal`, so players are told why it ended. Roster gaps
are grace-gated (`ROSTER_GRACE_MS`) so a sync hiccup cannot kill a live round.

**The solo demo is local-only** (`DemoPhase` in `machine.ts`). It never writes to the
synced `Match`, so it cannot disturb a real match forming around it, and it exits the
moment one starts. It exists because juries test submissions individually — a lone
visitor seeing "1 more player to start" is the worst possible first impression.

**The roster is built once a frame and cached.** It costs two entity scans, two sets
and a sort, and it is read about a dozen times a frame — five inside `hostTick`, once
per scoreboard row in the UI. `invalidateRoster()` runs from `gameSystem`
**after** `refreshSelfIdentity()`, never before: that call can be the one that first
writes our own userId, and a roster cached ahead of it would not contain us, so the
client would lose its own host election for a frame.

**A round spends its answer, not its options.** `startRound` adds only `answerId` to
`usedPromptIds`. Adding all four burned the featured pack four times faster and the
day's theme quietly stopped applying around round three of eight, while the lobby went
on advertising it. The decoys were never revealed as the answer and come from the same
pack anyway, so barring them buys nothing.

`src/config.ts` holds every tunable number. Prefer changing it over hardcoding.

## Interface rules learned on a device

**Emoji do not render.** Decentraland's interface font has no emoji glyphs. Tiles in the
emote wheel used to draw one above the label; it showed as nothing and cost a line of
height on every tile. Labels are text only.

**There is no bold.** `UiFontType` is `sans-serif | serif | monospace` and nothing else,
so weight is not available — contrast and size are the only levers.

**Four options go in a 2x2 grid, never a column** (`OptionGrid`). Stacked full-width they
took two thirds of a landscape phone screen, and what they covered was the actor. The
same component serves the guess screen, both pick screens and the reveal.

**Once an answer is locked the buttons go away.** The choice cannot be changed, and that
is exactly the moment the guesser should be watching rather than reading. The screen
drops from 66% of the height to 17%.

**Say who, not how many.** The reveal names the player who read you; the intermission
names who is on next. `readersOf` exists for this. A count is a report, a name is an
event, and they cost the same to render.

**The scoreboard outlives the roster.** Someone who leaves mid-match still has a score, so
`nameFor` remembers display names — otherwise the final standings show a raw wallet
address next to the points of the person who just left.

## Things that will bite you

**Deploy through Creator Hub, not the CLI.** The CLI's signing step fails with
`Proxy error: Request constructor: init.headers is a symbol` on every browser and login
method. Creator Hub publishes fine, and it lists Worlds you hold only *collaborator*
rights to — which the CLI documentation does not make obvious.

**`npm run deploy:world` exists for a reason.** Passing `--target-content` as a flag
loses the argument under PowerShell and the deploy then refuses to run.

**Never bump `PROTOCOL_VERSION` casually.** A newer client entering a room resets a
running old-build match, scoreboard included. Never do it inside a demo or judging
window.

**Regenerate `package-lock.json` in an empty directory**, never in place. With
`node_modules` present, npm prunes esbuild's optional platform packages down to the host
platform, and `npm ci` then fails on the Ubuntu CI runner for want of
`@esbuild/linux-x64`. Copy `package.json` to a temp dir, run
`npm install --package-lock-only` there, copy the lockfile back.

**Do not add 3D assets.** The scene is built entirely from ECS primitives, and having no
GLB to download is a deliberate mobile-performance argument, not a gap. Third-party asset
packs also raise licensing questions against an MIT repo.

**Creator Hub rewrites tracked files** on publish — `scene.json`, `main.crdt`,
`assets/scene/main.composite`. Review the diff before committing: the composite normally
gains only editor state (`inspector::*`), and anything renderable appearing there means
something was added by hand in the editor, on top of the code-built arena.

## Testing on a device

The mobile client runs **landscape, 1280x576**. That is the shape to design for; the
portrait branch in `theme.ts` never fires there. The client also paints its own
movement, jump and action buttons over the screen edges, and puts the player’s own
avatar dead centre — so the sheet is deliberately narrow and pushed left, or it covers
both the controls and the thing the game asks you to look at.

The workflow that actually finds things: record the screen for 60–90 seconds, drop the
file in `qa/` (git-ignored, dclignored), then use `ffmpeg` — it is installed. Contact
sheets are what make it usable:

```bash
ffmpeg -v error -i qa/video.mp4 -vf "fps=1,scale=340:-1,tile=6x5" -frames:v 1 qa/sheet.png
```

One image, thirty moments, readable in a single look. Raise the fps and drop the tile
count to inspect a transition frame by frame.

**Do not measure frame rate with `mpdecimate`.** It counts frames that did not change,
and a player standing still in front of a static card produces those honestly. It
reported "29.5 fps" for a session that was actually running at 38–52 — the slowest
stretches were the reveal screen sitting still. Only measure across stretches where
the camera is definitely moving.

**And do not fix anything from a single screenshot.** Two changes in one session were
wrong for that reason: the status board was "mirrored" only because the screenshot was
taken from outside the parcel looking back at one-sided text, and turning it would
have broken the reading from everywhere players actually stand. A recording carries
the context a still frame throws away.

## Deployment

Live at `castlerock.dcl.eth` — https://decentraland.org/jump/?realm=castlerock.dcl.eth

The World belongs to DCL Regenesis Labs; this project deploys into it with collaborator
rights granted for the Buildathon. `scene.json` names it in `worldConfiguration`.

Because the World is theirs, the jump-in page credits its owner and never names the
author of the scene. That cannot be changed and should not be. Authorship lives in the
scene metadata instead: `owner`, `contact.name`, and the root-level `description`, which
is the **Scene Info Panel** a visitor reads in-world — not to be confused with
`display.description`, the one-line blurb. Editing any of them changes nothing until the
scene is published again.

Creator Hub keeps its own copy of that panel in a root `SCENE_README.md`, which is what
its editor field reads and writes. That file is **not** uploaded and is **not** merged
into the deployed metadata — verified by comparing the deployed `description` against
both, byte for byte. So `scene.json` is the one that matters; treat `SCENE_README.md` as
editor state that happens to be committed, and keep the two in step by hand if you edit
the panel through the Hub.

## Writing about this project

Submission copy and docs must avoid the word "host" in the human sense — the Buildathon
terms disqualify projects that depend on a host, performer or moderator, and "host" here
means the elected authoritative client. Say "organiser" instead.

## The permission the whole game depends on

`triggerEmote` does nothing at all unless `scene.json` declares:

```json
"requiredPermissions": ["ALLOW_TO_TRIGGER_AVATAR_EMOTE"]
```

It fails silently — no error, no console warning, the avatar simply stands
there. This scene shipped without it for its entire life, which meant the one
mechanic the game is built on had never once run. Everything else can be
verified by reading the screen; this can only be verified by watching an avatar
actually move.

Emotes also only play while the player is standing still — walking or jumping
interrupts them.
