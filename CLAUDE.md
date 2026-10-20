# companion-module-dylanmaudio — working notes for Claude

Bitfocus Companion module for the **dylanmaudio apps**, one connection per
app: MIDI Bridge, Talk Light Trigger, Pilot Tone Trigger, Time Code Tool,
Console Control. TypeScript, MIT, Companion 5.0+
(`@companion-module/base` 2.1). See [README.md](README.md) for the full
layout and [companion/HELP.md](companion/HELP.md) for the user-facing guide.

## Where this sits

Part of **dylanmaudio** — Dylan Mitrovich's commercial software for live
sound, aimed at Allen & Heath dLive consoles, sold through
`store.dylanmaudio.com` (Lemon Squeezy) with product pages on
`dylanmaudio.com`. Mac first, no longer Mac only: MIDI Bridge has run on
Windows since 1.4.5, and Talk Light, Pilot Tone and Time Code Tool are in
testing there. Sibling repos:

- **`dLive-Utility-Apps`** — the monorepo of five menu-bar apps this module
  drives. It is where MIDI Bridge, the Client API and the control API live,
  and it is the authority for the API fixtures below.
- **`automation-pack`** — the older Reaper-based dLive Automation Pack
  (v0.9.x beta, NDA). Console Control supersedes it.
- **`dylanmaudio.github.io`** — the marketing site.

MIDI Bridge, Talk Light Trigger, Pilot Tone Trigger and Time Code Tool are
public, and so is **this module**: it has been on the Bitfocus store since
25 September. Console Control is not yet. So there *is* shipped-version
compatibility to preserve. Action and option ids are frozen — a rename
breaks the buttons someone already built, and any change to one needs an
upgrade script in `src/upgrades.ts`. Adding ids is free; changing them is
not. The apps this module drives are in customers' hands too, and the
control API it depends on is theirs to keep working.

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

Three things about that script and this repo's copies, each of which cost a
broken `main` on 20 Oct 2026:

- **The script runs both ways, whatever you were told when asked to run
  it.** Before its reverse section it copies *this* repo's `fixtures/tx.json`,
  `fixtures/rx.json` and `docs/protocol.md` INTO the monorepo. Diff those
  three first: if they differ, running it promotes a codec change upstream,
  possibly into someone else's merge. (The monorepo now also has
  `--from-module`, which reads here and writes nothing.)
- **A fixture moves with the code that reads it.** `labels.test.ts` requires
  every control a `fixtures/control/*.json` offers to have a key label, so a
  fixture whose labels live on a branch turns `main` red. Take
  `fixtures/api/exchanges.json` alone when that's what's wanted, and let the
  rest arrive with their branch. **So `main` reading as "behind" the monorepo
  on some fixtures is correct** while a branch owns the pairing; a drift
  report that compares only against `main` will keep flagging them, and
  acting on it breaks the build every time.
- **One writer per checkout.** Other threads work in sibling worktrees and on
  the monorepo. Nobody runs anything that writes into another's working tree —
  a `git checkout --` to tidy up destroys uncommitted work silently. Ask the
  owner to run it.

## Where a claim comes from

`docs/protocol.md` grades every protocol claim — `hardware`, `two-impl`,
`single`, `inferred` — and the grade is only worth what the sourcing is. A
claim traces to a capture in `sim/captures/`, a document someone has actually
read, or an implementation someone has actually looked at. **A search-result
summary is not a source, and neither is another thread's message.**

On 20 Oct 2026 "A&H's 40 connections is their network-application count"
reached this repo's `protocol.md` stated as fact. It traced back to a
sub-agent's summary of a support article that returns 403. Three threads
repeated it until it sounded established. Going to the primary record before
citing it is cheap; do that, and quote what it actually says, including the
caveats it puts on itself.

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
