# companion-module-dylanmaudio — working notes for Claude

Bitfocus Companion module for the **dylanmaudio apps**, one connection per
app: dLive MIDI Bridge, Talk Light Trigger, Pilot Tone Trigger, Time Code
Tool, Console Control. TypeScript, MIT, Companion 5.0+
(`@companion-module/base` 2.1). See [README.md](README.md) for the full
layout and [companion/HELP.md](companion/HELP.md) for the user-facing guide.

## Where this sits

Part of **dylanmaudio** — Dylan Mitrovich's commercial macOS software for
live sound, aimed at Allen & Heath dLive consoles, sold through
`store.dylanmaudio.com` (Lemon Squeezy) with product pages on
`dylanmaudio.com`. Sibling repos:

- **`dLive-Utility-Apps`** — the monorepo of five macOS menu-bar apps this
  module drives. It is where MIDI Bridge, the Client API and the control API
  live, and it is the authority for the API fixtures below.
- **`automation-pack`** — the older Reaper-based dLive Automation Pack
  (v0.9.x beta, NDA). Console Control supersedes it.
- **`dylanmaudio.github.io`** — the marketing site.

MIDI Bridge, Talk Light Trigger, Pilot Tone Trigger and Time Code Tool are
public; Console Control and **this module** are not. So there is no
shipped-version compatibility to preserve here — changes ship at launch —
but the apps this module drives *are* in customers' hands, and the control
API it depends on is theirs to keep working.

## The rule that matters here

**This module never connects to a console directly.** It attaches to the
MIDI Bridge app (v1.1+) as a named lane over the Client API; the bridge owns
the console connection, the state mirror, timed fades and the base channel.
`ConsoleLink` / `TcpTransport` exist *only* as a test harness against the
Virtual dLive and are excluded from `dist` by `tsconfig.build.json` — don't
promote them into the shipping path.

## Fixtures sync in two directions

- `fixtures/tx.json` / `fixtures/rx.json` — golden byte fixtures, the
  **authority for the codec**, authored here; the monorepo's Python side
  (MIDI Bridge / Virtual dLive) must pass them too. Console-protocol
  fixtures sync **module → monorepo**.
- `fixtures/api/` (Client API) and `fixtures/control/` (the other apps'
  control API) are authored in the **monorepo** and vendored here — they
  sync **monorepo → module**.

`tools/sync_fixtures.sh` (in the monorepo) is the only correct way to move
either. Never hand-edit whichever copy is downstream. When a hardware
capture contradicts a fixture, fix the fixture with the capture attached and
both implementations follow.

The console event vocabulary is a contract with three consumers: this
module's `decode.ts`, the bridge's Client API, and Console Control's stream
comparator. A fixture promotion or decoder-rule change re-runs all three,
not just this repo's suite.

## Build & test

```bash
corepack yarn install
corepack yarn test          # unit + fixtures (+ e2e when the Virtual dLive is present)
corepack yarn build
corepack yarn lint
corepack yarn package       # → pkg/ .tgz for Companion's "Import module package"
```

`src/e2e.test.ts` spawns `python3 -m sim.virtual_console` from the monorepo
checkout (override the path with `DLIVE_SIM_ROOT`) and drives the real
module against it — hardware-free end to end.

## Prior art

Several byte-level value maps derive from two MIT Companion modules
(Tim Steer's `companion-module-allenheath-dlive`; Andrew Broughton, Shaun
Davids et al.'s `companion-module-allenheath-dlive-ilive`). Their notices
travel with the derived values, and `docs/protocol.md` records which claims
rest on one implementation, two, or verified hardware. Keep that attribution
intact.
