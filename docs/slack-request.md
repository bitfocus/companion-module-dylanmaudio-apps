# Bitfocus repo request: `companion-module-dylanmaudio-apps`

The second request, now that the module meets the conditions set in
August. The first request (`dylanmaudio-dlive`, 27–29 Aug 2026) and how it
was answered are kept at the foot of this file.

## Status

- **24 Sep 2026.** The portal reviewed v1.0.0 and asked for one change:
  `legacyIds` must be empty on a first release. Emptied, and resubmitted as
  v1.0.1. The development rig had already moved to the new id by hand, so
  nothing depended on the old one.
- **17 Sep 2026.** The reviewers answered the request and suggested the
  id `dylanmaudio-apps`, so the module now uses it: in the manifest, the
  package name and the TALK page import. `legacyIds: ["dylanmaudio"]`
  carries across connections made with pre-release builds, including the
  development rig. Not approved yet. Next, a maintainer creates the repo
  in the bitfocus org.

## Process (checked 14 Sep 2026)

Sources: companion.free's _Releasing your module_ (edited 31 Aug 2026) and
the CI workflow every module repo runs (`bitfocus/actions`
module-checks.yaml, 8 Sep 2026).

1. **Post in `#module-development`** on the Bitfocus Slack. Include your
   GitHub username and the module name. There is no form or template; an
   issue in `bitfocus/companion-module-requests` does not count.
2. **A maintainer creates `bitfocus/companion-module-dylanmaudio-apps`** and
   gives `dylanmaudio` write access. Push this repo's history there.
3. **Point the manifest's `repository` and `bugs` at the bitfocus repo**,
   and set `package.json`'s repository URL to match.
4. **Tag `v1.0.0`** (it must equal `package.json`'s version) and submit
   the tag at <https://developer.bitfocus.io>: My Connections → Submit
   Version. Volunteers review it, and feedback arrives in the portal. Once
   approved, anyone on Companion 5.0+ can install the module.

### What the CI gate checks, and where this repo stands

| Check                                                               | Status               |
| ------------------------------------------------------------------- | -------------------- |
| `yarn.lock` present, no `package-lock.json`                         | ✓                    |
| repo is `companion-module-<id>`, and the manifest id equals `<id>`  | ✓ `dylanmaudio-apps` |
| tag equals the `package.json` version                               | at tag time          |
| manifest `runtime.apiVersion` is `0.0.0` (the build fills it in)    | ✓                    |
| `products` not empty, no template placeholders                      | ✓                    |
| `companion/HELP.md` exists                                          | ✓                    |
| `@companion-module/tools` ≥ 3.1.0                                   | ✓ 3.1.0              |
| `yarn build`, then `companion-module-build`, then the package loads | ✓ locally            |
| `package.json` licence MIT                                          | ✓                    |

### Settled before posting

- **The condition from August.** The module can't connect to a console.
  It talks only to the MIDI Bridge, and the direct code is a test harness
  kept out of `dist`. The manufacturer is `dylanmaudio`, and the products
  are the apps.
- **No special permissions.** Keys no longer start apps (that needed
  `child-process`, which Companion flags as dangerous). They bring a
  running app to the front.
- **The first public version is 1.0.0**, as Bitfocus's versioning guide
  asks.
- **`legacyIds` is empty.** The review asked for that on a first release,
  and nothing was ever published under the old id.
- **The id is `dylanmaudio-apps`**, as the reviewers suggested (17 Sep).

### Worth doing first (optional)

- **The PR #8 comment.** Reviewers said they'd rather see you help the
  existing `allenheath-dlive` module. The drafted findings on
  `BrentonStarkie`'s PR #8, as corrected on 13 Sep, haven't been posted.
  Posting them first backs up the offer at the end of the message.

## The message (draft of 14 Sep)

> Hi! A follow-up to my request from late August (`dylanmaudio-dlive`).
> I've made the changes you asked for, and I'd like to request a repo under
> the new name:
>
> **Module:** `companion-module-dylanmaudio` · **GitHub:** `dylanmaudio` ·
> **Code:** https://github.com/dylanmaudio/companion-module-dylanmaudio
>
> What's changed since August:
>
> - **No direct console connection.** The module only talks to my own
>   apps, on the same machine or the LAN. For dLive, that's the dLive
>   MIDI Bridge app, which owns the connection to the desk. The module never
>   opens a socket to a console, and the old direct code survives only as a
>   test harness that isn't in the built package.
> - **The manufacturer is `dylanmaudio`.** The products are my apps: dLive
>   MIDI Bridge, Talk Light Trigger, Pilot Tone Trigger, Time Code Tool and
>   Console Control. Nothing lists under Allen & Heath.
>
> How it works: one connection per app. Each app publishes a small local
> control API with a catalogue of its controls and live state. The module
> builds actions, feedbacks, variables and presets from that catalogue, so a
> feature added to an app appears in Companion without a module release.
>
> Tech: TypeScript on `@companion-module/base` 2.1 (Companion 5.0+), MIT,
> no special permissions. It has 400+ unit tests plus end-to-end tests
> against a dLive simulator, and I've been running it live on Companion 5.0.5
> with a Stream Deck XL.
>
> On the name: it's plain `dylanmaudio` because the one module covers every
> dylanmaudio app. If you'd rather keep the `manufacturer-product` shape,
> `dylanmaudio-apps` works for me.
>
> I'm also still keen to help get state feedback into `allenheath-dlive` via
> PR #8. I've tested it against my simulator, and my notes are on the PR.
>
> Thanks!

Drop the last paragraph if the PR #8 comment isn't posted yet, or change
it to "notes to follow on the PR".

---

## The first request (27–29 Aug 2026), for the record

The first message asked for `companion-module-dylanmaudio-dlive`, a
direct-to-console dLive module with state feedback, with the manifest's
manufacturer set to Allen & Heath. Two reviewers asked, reasonably, why
state feedback shouldn't go into the existing modules instead. Then they
set out a concrete way forward:

> Remove the ability to connect to the console directly from the module
> and change the manifest so that it's clearly targeted toward your
> middleware instead and doesn't include a manufacturer that you're not.
> But we'd much rather see you contribute toward a companion module that
> can do all of this natively.

Tim Steer (`shedworth`), who maintains `allenheath-dlive`, replied warmly.
He'd welcome feedback support as an enhancement, and pointed at PR #8
(`BrentonStarkie`), which has been open since February. Its tester deferred,
and Tim has no desk to test on, so hardware is what's blocking it.

**Correction, 13 Sep 2026.** The lone `Bn 63 <ch>` fader ping blamed on
the console was really MIDI Bridge's inbound parser dropping running
status (bridge `0ff0f46`). The desk replies and broadcasts in running
status, which PR #8's framer parses correctly. Its framer stall is a real
bug, but on a real desk it only fires on another client's bare select
relayed raw. Restate it that way in the PR comment.

What happened next:

- The module retargeted to the bridge in `a7e0b6e`: manufacturer
  `dylanmaudio`, and no direct option in the connection form.
- Its id became `dylanmaudio` on 11 Sep, when it grew to cover every
  dylanmaudio app.
- On 14 Sep the direct path left the shipped code altogether. Before then,
  a config carrying `transport: "direct"` could still reach it.
