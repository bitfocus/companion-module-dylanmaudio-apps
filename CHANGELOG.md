# Changelog — dylanmaudio-apps (Bitfocus Companion module)

## Unreleased

- **Names and colours arrive on connect.** The desk announces only what
  changes, and the bridge's mirror starts empty, so a connection made
  mid-show showed nothing until someone moved something. The module now
  asks the bridge for each strip in scope on connect and on **Resync**,
  through its `query` op. **Ask the console for** in the connection
  settings chooses how much: names and colours, plus mutes and levels, or
  nothing.
- **Muted keys say MUTED**, on a red darker than any desk colour — a
  channel coloured red read the same muted or not.
- **One text size per key shape** across the MIDI Bridge presets, instead
  of a size picked per label.

## 1.0.1 — 2026-09

- `legacyIds` is empty, as the module review asked for a first release.
- Pilot Tone Trigger 1.1: the **Flip A/B** key, the **Signal Degraded**
  state on the status tile (violet), the menu-bar icon (orange) and the
  level meter, and the `integrity_errors` variable.

## 1.0.0 — 2026-09 (submitted to Bitfocus)

First release. One connection per dylanmaudio app:

- **dLive MIDI Bridge** — attaches to the bridge's Client API as a named
  lane (never to the console directly): mutes, fader levels with timed
  fades, names, colours, scene recall and Actions, with full state
  feedback, variables and self-labelling presets; bridge start / stop /
  restart and status through the bridge's own control endpoint.
- **Talk Light Trigger** — Run and Threshold, live state, and the Talk
  flash page (`companion/talk-flash.companionconfig`).
- **Pilot Tone Trigger** — Run, Failback mode, Reset, the tone generator,
  the threshold; state reflected on the keys.
- **Time Code Tool** — Start/Stop, Read/Generate, input source, MTC and
  LTC output, counters, generator start and rate, and multi-key timecode
  readout presets.
- **Console Control** — every remote-flagged command of the app's
  registry (transport, locate, record, Show Mode, conform), state from
  the app's tick.
- Every app: an "open app" key that brings the running app forward,
  a status feed, and the app's own "Companion control" and "Lock
  show-critical controls" switches honoured.

Requires the apps (MIDI Bridge 1.1.9+ for the bridge controls). Companion
5.0+ (`@companion-module/base` 2.1). MIT.
