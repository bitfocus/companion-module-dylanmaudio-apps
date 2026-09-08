#!/usr/bin/env python3
"""
author.py — builds fixtures/tx.json and fixtures/rx.json from the byte
templates in docs/protocol.md.

The JSON files are the authority, not this script: it exists so a
correction (e.g. a September hardware capture that contradicts a
`two-impl` case) can be applied in one place and re-emitted. It is
deliberately NOT an implementation of the codec — no shared code with
src/ or with MIDI Bridge — so that neither implementation is secretly
testing itself.

    python3 fixtures/author.py        # rewrites tx.json / rx.json
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
HDR = [0xF0, 0x00, 0x00, 0x1A, 0x50, 0x10, 0x01, 0x00]
EOX = 0xF7

# (type, midi offset, address start, count) — protocol.md §2
TYPES = {
    "input":          (0, 0x00, 128),
    "mono_group":     (1, 0x00, 62),
    "stereo_group":   (1, 0x40, 31),
    "mono_aux":       (2, 0x00, 62),
    "stereo_aux":     (2, 0x40, 31),
    "mono_matrix":    (3, 0x00, 62),
    "stereo_matrix":  (3, 0x40, 31),
    "mono_fx_send":   (4, 0x00, 16),
    "stereo_fx_send": (4, 0x10, 16),
    "fx_return":      (4, 0x20, 16),
    "main":           (4, 0x30, 6),
    "dca":            (4, 0x36, 24),
    "mute_group":     (4, 0x4E, 8),
    "ufx_send":       (4, 0x56, 8),
    "ufx_return":     (4, 0x5E, 8),
}
SOCKET_BANKS = {"mixrack": 0x00, "dx12": 0x40, "dx34": 0x60}


def addr(t: str, index: int) -> tuple[int, int]:
    off, start, count = TYPES[t]
    assert 1 <= index <= count, (t, index)
    return off, start + index - 1


def hexs(b: list[int]) -> str:
    return " ".join(f"{x:02x}" for x in b)


tx: list[dict] = []
rx: list[dict] = []


def T(id_, tier, intent, data, *, base=1, socket="mixrack", note=None):
    case = {"id": id_, "tier": tier, "dir": "tx", "socket": socket,
            "base_channel": base, "intent": intent, "hex": hexs(data)}
    if note:
        case["note"] = note
    tx.append(case)


def R(id_, tier, data, events, *, base=1, socket="mixrack", chunks=None, note=None,
      midi_strips=False):
    case = {"id": id_, "tier": tier, "dir": "rx", "socket": socket,
            "base_channel": base, "hex": hexs(data), "events": events}
    if midi_strips:
        # Decode channels 2-3 as MIDI Strips. Opt-in per case because on base
        # channel 1-3 those are also the protocol's group and aux channels.
        case["midi_strips"] = True
    if chunks:
        case["chunks"] = [hexs(c) for c in chunks]
    if note:
        case["note"] = note
    rx.append(case)


# ---------------------------------------------------------------- encoders
def mute(n, t, i, on, base=1):
    off, ch = addr(t, i)
    return [0x90 | (n + off), ch, 0x7F if on else 0x3F]


def nrpn(n, t, i, param, value):
    off, ch = addr(t, i)
    s = 0xB0 | (n + off)
    return [s, 0x63, ch, s, 0x62, param, s, 0x06, value]


def scene(n, s):
    idx = s - 1
    return [0xB0 | n, 0x00, idx // 128, 0xB0 | n, 0x20, 0x00, 0xC0 | n, idx % 128]


def cue(n, id_):
    return [0xB0 | n, 0x00, min(15, id_ // 128), 0xC0 | n, id_ % 128]


def sysex(n_off, body):
    return HDR + [n_off] + body + [EOX]


def send_level(n, t, i, dt, di, lv):
    off, ch = addr(t, i)
    doff, dch = addr(dt, di)
    return sysex(n + off, [0x0D, ch, n + doff, dch, lv])


def mix_assign(n, i, dt, di, on):
    off, ch = addr("input", i)
    doff, dch = addr(dt, di)
    return sysex(n + off, [0x0E, ch, n + doff, dch, 0x40 if on else 0x00])


def sock(bank, index):
    assert 1 <= index <= (64 if bank == "mixrack" else 32)
    return SOCKET_BANKS[bank] + index - 1


# ---------------------------------------------------------------- TX cases
for base in (1, 12):
    n = base - 1
    b = f"b{base}"
    # §3.1 mute
    T(f"mute.input1.on.{b}", "hardware", {"op": "mute", "type": "input", "index": 1, "on": True}, mute(n, "input", 1, True), base=base)
    T(f"mute.input1.off.{b}", "hardware", {"op": "mute", "type": "input", "index": 1, "on": False}, mute(n, "input", 1, False), base=base)
    T(f"mute.dca3.on.{b}", "hardware", {"op": "mute", "type": "dca", "index": 3, "on": True}, mute(n, "dca", 3, True), base=base)
    T(f"mute.mutegroup1.on.{b}", "hardware", {"op": "mute", "type": "mute_group", "index": 1, "on": True}, mute(n, "mute_group", 1, True), base=base)
    T(f"mute.stereoaux2.off.{b}", "hardware", {"op": "mute", "type": "stereo_aux", "index": 2, "on": False}, mute(n, "stereo_aux", 2, False), base=base)
    T(f"mute.input128.on.{b}", "hardware", {"op": "mute", "type": "input", "index": 128, "on": True}, mute(n, "input", 128, True), base=base)
    # §3.2 fader
    T(f"fader.input1.unity.{b}", "hardware", {"op": "fader", "type": "input", "index": 1, "level": 107}, nrpn(n, "input", 1, 0x17, 107), base=base)
    T(f"fader.input12.minusinf.{b}", "hardware", {"op": "fader", "type": "input", "index": 12, "level": 0}, nrpn(n, "input", 12, 0x17, 0), base=base)
    T(f"fader.main1.max.{b}", "hardware", {"op": "fader", "type": "main", "index": 1, "level": 127}, nrpn(n, "main", 1, 0x17, 127), base=base)
    T(f"fader.monoaux62.{b}", "hardware", {"op": "fader", "type": "mono_aux", "index": 62, "level": 64}, nrpn(n, "mono_aux", 62, 0x17, 64), base=base)
    T(f"fader.ufxreturn8.{b}", "hardware", {"op": "fader", "type": "ufx_return", "index": 8, "level": 100}, nrpn(n, "ufx_return", 8, 0x17, 100), base=base)
    # §3.4 scene
    T(f"scene.1.{b}", "hardware", {"op": "scene", "scene": 1}, scene(n, 1), base=base)
    T(f"scene.128.{b}", "hardware", {"op": "scene", "scene": 128}, scene(n, 128), base=base)
    T(f"scene.129.{b}", "hardware", {"op": "scene", "scene": 129}, scene(n, 129), base=base, note="bank in CC0 (MSB); CC32 = 0 — byte-identical to the proven Reaper stream")
    T(f"scene.500.{b}", "hardware", {"op": "scene", "scene": 500}, scene(n, 500), base=base)
    # §3.7 actions / §3.6 surface CC
    T(f"action.cc20.v1.{b}", "hardware", {"op": "action", "cc": 20, "value": 1}, [0xB0 | n, 20, 1], base=base)
    T(f"surface_cc.go.{b}", "hardware", {"op": "surface_cc", "cc": 64, "value": 127}, [0xB0 | n, 64, 127], base=base, socket="surface")
    # §3.11 name & colour
    T(f"get_name.input1.{b}", "hardware", {"op": "get_name", "type": "input", "index": 1}, sysex(n, [0x01, 0x00]), base=base)
    T(f"get_name.dca5.{b}", "hardware", {"op": "get_name", "type": "dca", "index": 5}, sysex(n + 4, [0x01, 0x3A]), base=base)
    T(f"set_name.input1.kick.{b}", "hardware", {"op": "set_name", "type": "input", "index": 1, "name": "Kick"}, sysex(n, [0x03, 0x00] + list(b"Kick")), base=base)
    T(f"set_name.input2.nonascii.{b}", "hardware", {"op": "set_name", "type": "input", "index": 2, "name": "Gtré"}, sysex(n, [0x03, 0x01] + list(b"Gtr?")), base=base, note="non-ASCII becomes '?' to stay 7-bit")
    T(f"get_colour.input1.{b}", "hardware", {"op": "get_colour", "type": "input", "index": 1}, sysex(n, [0x04, 0x00]), base=base)
    T(f"set_colour.input1.red.{b}", "hardware", {"op": "set_colour", "type": "input", "index": 1, "colour": "red"}, sysex(n, [0x06, 0x00, 0x01]), base=base)
    T(f"set_colour.stereogroup3.white.{b}", "hardware", {"op": "set_colour", "type": "stereo_group", "index": 3, "colour": "white"}, sysex(n + 1, [0x06, 0x42, 0x07]), base=base)

n = 0  # remaining cases on base channel 1 only — the offset math is proven above
# §3.3 NRPN parameters
T("main_assign.input1.on", "two-impl", {"op": "main_assign", "type": "input", "index": 1, "on": True}, nrpn(n, "input", 1, 0x18, 0x7F))
T("main_assign.input1.off", "two-impl", {"op": "main_assign", "type": "input", "index": 1, "on": False}, nrpn(n, "input", 1, 0x18, 0x3F))
T("dca_assign.input1.dca1.on", "two-impl", {"op": "dca_assign", "type": "input", "index": 1, "dca": 1, "on": True}, nrpn(n, "input", 1, 0x40, 0x40))
T("dca_assign.input1.dca24.on", "two-impl", {"op": "dca_assign", "type": "input", "index": 1, "dca": 24, "on": True}, nrpn(n, "input", 1, 0x40, 0x57))
T("dca_assign.input1.dca1.off", "two-impl", {"op": "dca_assign", "type": "input", "index": 1, "dca": 1, "on": False}, nrpn(n, "input", 1, 0x40, 0x00))
T("mutegroup_assign.input1.mg1.on", "two-impl", {"op": "mute_group_assign", "type": "input", "index": 1, "group": 1, "on": True}, nrpn(n, "input", 1, 0x40, 0x58))
T("mutegroup_assign.input1.mg8.off", "two-impl", {"op": "mute_group_assign", "type": "input", "index": 1, "group": 8, "on": False}, nrpn(n, "input", 1, 0x40, 0x1F))
T("peq.input1.band1.type.bell", "two-impl", {"op": "peq", "type": "input", "index": 1, "band": 1, "param": "type", "value": 0}, nrpn(n, "input", 1, 0x1A, 0))
T("peq.input1.band1.freq", "two-impl", {"op": "peq", "type": "input", "index": 1, "band": 1, "param": "freq", "value": 72}, nrpn(n, "input", 1, 0x1B, 72))
T("peq.input1.band2.width", "two-impl", {"op": "peq", "type": "input", "index": 1, "band": 2, "param": "width", "value": 5}, nrpn(n, "input", 1, 0x20, 5))
T("peq.input1.band4.gain", "two-impl", {"op": "peq", "type": "input", "index": 1, "band": 4, "param": "gain", "value": 64}, nrpn(n, "input", 1, 0x29, 64))
T("hpf_freq.input1", "two-impl", {"op": "hpf_freq", "index": 1, "value": 40}, nrpn(n, "input", 1, 0x30, 40))
T("hpf_on.input1.on", "two-impl", {"op": "hpf_on", "index": 1, "on": True}, nrpn(n, "input", 1, 0x31, 0x40))
T("hpf_on.input1.off", "two-impl", {"op": "hpf_on", "index": 1, "on": False}, nrpn(n, "input", 1, 0x31, 0x00))
# §3.5 cue list (surface)
T("cue_list.0", "single", {"op": "cue_list", "id": 0}, cue(n, 0), socket="surface")
T("cue_list.129", "single", {"op": "cue_list", "id": 129}, cue(n, 129), socket="surface")
T("cue_list.1999", "single", {"op": "cue_list", "id": 1999}, cue(n, 1999), socket="surface")
# §3.8 send level
T("send_level.input1.monoaux1", "hardware", {"op": "send_level", "type": "input", "index": 1, "dest_type": "mono_aux", "dest_index": 1, "level": 107}, send_level(n, "input", 1, "mono_aux", 1, 107), note="LV↔dB uncalibrated for sends")
T("send_level.input3.stereofx2", "hardware", {"op": "send_level", "type": "input", "index": 3, "dest_type": "stereo_fx_send", "dest_index": 2, "level": 0}, send_level(n, "input", 3, "stereo_fx_send", 2, 0))
T("send_level.monogroup2.stereomatrix1", "hardware", {"op": "send_level", "type": "mono_group", "index": 2, "dest_type": "stereo_matrix", "dest_index": 1, "level": 64}, send_level(n, "mono_group", 2, "stereo_matrix", 1, 64))
T("send_level.fxreturn1.ufxsend1", "hardware", {"op": "send_level", "type": "fx_return", "index": 1, "dest_type": "ufx_send", "dest_index": 1, "level": 90}, send_level(n, "fx_return", 1, "ufx_send", 1, 90))
# §3.9 mix assign
T("mix_assign.input1.monogroup1.on", "two-impl", {"op": "mix_assign", "index": 1, "dest_type": "mono_group", "dest_index": 1, "on": True}, mix_assign(n, 1, "mono_group", 1, True))
T("mix_assign.input5.stereoaux3.off", "two-impl", {"op": "mix_assign", "index": 5, "dest_type": "stereo_aux", "dest_index": 3, "on": False}, mix_assign(n, 5, "stereo_aux", 3, False))
# §3.10 preamp
T("preamp_gain.mixrack1", "two-impl", {"op": "preamp_gain", "bank": "mixrack", "socket": 1, "value": 64}, [0xE0 | n, sock("mixrack", 1), 64], note="raw value here; the +5…+60 dB range is settled on hardware at GV 00 and 7F")
T("preamp_gain.dx12.socket5", "two-impl", {"op": "preamp_gain", "bank": "dx12", "socket": 5, "value": 0}, [0xE0 | n, sock("dx12", 5), 0])
T("preamp_gain.dx34.socket32", "two-impl", {"op": "preamp_gain", "bank": "dx34", "socket": 32, "value": 127}, [0xE0 | n, sock("dx34", 32), 127])
T("preamp_pad.mixrack1.on", "two-impl", {"op": "preamp_pad", "bank": "mixrack", "socket": 1, "on": True}, sysex(n, [0x09, 0x00, 0x40]))
T("preamp_48v.mixrack64.off", "two-impl", {"op": "preamp_48v", "bank": "mixrack", "socket": 64, "on": False}, sysex(n, [0x0C, 0x3F, 0x00]))
# §3.12 UFX
T("ufx_key.a", "two-impl", {"op": "ufx_key", "key": 9}, [0xB0 | n, 0x0C, 9])
T("ufx_scale.minor", "two-impl", {"op": "ufx_scale", "scale": 1}, [0xB0 | n, 0x0D, 1])
# §3.13 gets
T("get_mute.input1", "single", {"op": "get_mute", "type": "input", "index": 1}, sysex(n, [0x05, 0x09, 0x00]))
T("get_mute.dca2", "single", {"op": "get_mute", "type": "dca", "index": 2}, sysex(n + 4, [0x05, 0x09, 0x37]))
T("get_fader.input1", "single", {"op": "get_fader", "type": "input", "index": 1}, sysex(n, [0x05, 0x0B, 0x17, 0x00]))
T("get_fader.stereoaux1", "single", {"op": "get_fader", "type": "stereo_aux", "index": 1}, sysex(n + 2, [0x05, 0x0B, 0x17, 0x40]))
T("get_param.main_assign.input1", "inferred", {"op": "get_param", "type": "input", "index": 1, "param": 0x18}, sysex(n, [0x05, 0x0B, 0x18, 0x00]))
T("get_param.hpf_on.input1", "inferred", {"op": "get_param", "type": "input", "index": 1, "param": 0x31}, sysex(n, [0x05, 0x0B, 0x31, 0x00]))
T("get_send_level.input1.monoaux1", "single", {"op": "get_send_level", "type": "input", "index": 1, "dest_type": "mono_aux", "dest_index": 1}, sysex(n, [0x05, 0x0F, 0x0D, 0x00, n + 2, 0x00]))
T("get_mix_assign.input1.monogroup1", "inferred", {"op": "get_mix_assign", "index": 1, "dest_type": "mono_group", "dest_index": 1}, sysex(n, [0x05, 0x0F, 0x0E, 0x00, n + 1, 0x00]))
# Preamp Gets do NOT follow the generic `05 <type> …` pattern the rest
# of the Gets do — the PDF documents dedicated ops for pad and 48 V, and
# an NRPN-style Get for gain. Was `inferred` from the pattern; now
# `single` from the PDF (p.4).
# §3.7: the spec names this message by its DESTINATION and puts no stated
# restriction on the source. Aux 1 -> Matrix 1 moved the send on hardware.
# Note the asymmetry: the same source on a mix ASSIGN was relayed and ignored.
T("send_level.monoaux1.monomatrix1", "hardware", {"op": "send_level", "type": "mono_aux", "index": 1, "dest_type": "mono_matrix", "dest_index": 1, "level": 107}, send_level(n, "mono_aux", 1, "mono_matrix", 1, 107), note="undocumented source; confirmed on hardware 5 Sep 2026. No dLive module offers this")
T("get_preamp_gain.mixrack1", "hardware", {"op": "get_preamp_gain", "bank": "mixrack", "socket": 1}, sysex(n, [0x05, 0x0B, 0x19, 0x00]), note="this exact form answers with a pitch bend; the socket goes where the PDF writes CH, so that was not a doc slip. The inferred 05 0E form is silent and was never emitted here")
T("get_preamp_pad.mixrack1", "hardware", {"op": "get_preamp_pad", "bank": "mixrack", "socket": 1}, sysex(n, [0x07, 0x00]), note="dedicated Get op 07, answered with reply op 08 — not the generic 05 0F form that was inferred before")
T("get_preamp_48v.dx12.socket1", "hardware", {"op": "get_preamp_48v", "bank": "dx12", "socket": 1}, sysex(n, [0x0A, 0x40]), note="dedicated Get op 0A, answered with reply op 0B")

# ---------------------------------------------------------------- RX cases
for base in (1, 12):
    n = base - 1
    b = f"b{base}"
    R(f"rx.mute.input1.on.echo.{b}", "hardware", [0x90 | n, 0x00, 0x7F], [{"kind": "mute", "type": "input", "index": 1, "on": True}], base=base)
    R(f"rx.mute.input1.off.echo.{b}", "hardware", [0x90 | n, 0x00, 0x3F], [{"kind": "mute", "type": "input", "index": 1, "on": False}], base=base)
    R(f"rx.mute.input1.on.spec.{b}", "single", [0x90 | n, 0x00, 0x40], [{"kind": "mute", "type": "input", "index": 1, "on": True}], base=base, note="0x40 is the lowest ON velocity (spec: 40-7F = on) — threshold decode")
    R(f"rx.mute.input1.lowest_off.{b}", "single", [0x90 | n, 0x00, 0x01], [{"kind": "mute", "type": "input", "index": 1, "on": False}], base=base, note="0x01 is the lowest OFF velocity (spec: 01-3F = off)")
    # Velocity 0 is NOT a mute-off. It is the note-off half of the
    # console's own pair ("9N CH 7F, [9N] CH 00", spec p.2), and the
    # spec's receive table is explicit: "Velocity 00 and NOTE OFF
    # messages are ignored", with the OFF range starting at 01.
    # Decoding it as mute-off makes every console mute-on arrive as
    # on-then-immediately-off. Capture the real pair on 2026-09-04.
    R(f"rx.mute.velocity0.ignored.{b}", "hardware", [0x90 | n, 0x00, 0x7F, 0x90 | n, 0x00, 0x00], [{"kind": "mute", "type": "input", "index": 1, "on": True}], base=base, note="the console's mute pair, confirmed on hardware: a desk mute press broadcasts 7F (or 3F for off) then the 00 terminator. Reading the terminator as a mute-off makes every desk mute arrive as on-then-immediately-off")
    R(f"rx.mute.dca3.{b}", "hardware", [0x90 | (n + 4), 0x38, 0x7F], [{"kind": "mute", "type": "dca", "index": 3, "on": True}], base=base)
    R(f"rx.ping.input1.{b}", "hardware", [0xB0 | n, 0x63, 0x00], [{"kind": "fader_ping", "type": "input", "index": 1}], base=base, note="lone NRPN MSB — fader moved, no level")
    R(f"rx.ping.stereogroup2.{b}", "hardware", [0xB0 | (n + 1), 0x63, 0x41], [{"kind": "fader_ping", "type": "stereo_group", "index": 2}], base=base)
    R(f"rx.fader.input1.unity.{b}", "single", [0xB0 | n, 0x63, 0x00, 0xB0 | n, 0x62, 0x17, 0xB0 | n, 0x06, 0x6B], [{"kind": "fader", "type": "input", "index": 1, "level": 107}], base=base, note="Get Fader reply shape (assumed = set shape). No ping is emitted when the triple completes.")
    R(f"rx.scene.129.{b}", "hardware", [0xB0 | n, 0x00, 0x01, 0xC0 | n, 0x01], [{"kind": "scene", "scene": 130}], base=base, note="bank 1, pc 1 → scene 130")
    R(f"rx.scene.1.nobank.{b}", "hardware", [0xC0 | n, 0x00], [{"kind": "scene", "scene": 1}], base=base, note="lone PC with no bank seen this session → bank 0")
    R(f"rx.name.input1.kick.{b}", "hardware", sysex(n, [0x02, 0x00] + list(b"Kick")), [{"kind": "name", "type": "input", "index": 1, "name": "Kick"}], base=base)
    R(f"rx.colour.input1.red.{b}", "hardware", sysex(n, [0x05, 0x00, 0x01]), [{"kind": "colour", "type": "input", "index": 1, "colour": "red"}], base=base)

n = 0
# stream mechanics — protocol.md §5
R("rx.running_status.mutes", "hardware", [0x90, 0x00, 0x7F, 0x01, 0x3F, 0x02, 0x7F],
  [{"kind": "mute", "type": "input", "index": 1, "on": True},
   {"kind": "mute", "type": "input", "index": 2, "on": False},
   {"kind": "mute", "type": "input", "index": 3, "on": True}])
R("rx.realtime.mid_message", "hardware", [0x90, 0x00, 0xF8, 0x7F],
  [{"kind": "mute", "type": "input", "index": 1, "on": True}], note="F8 inside a message is dropped, message completes")
R("rx.realtime.mid_sysex", "hardware", HDR + [0x00, 0x02, 0x00, ord("K"), 0xF8, ord("i"), ord("c"), ord("k"), EOX],
  [{"kind": "name", "type": "input", "index": 1, "name": "Kick"}])
R("rx.split.sysex_across_chunks", "hardware", sysex(n, [0x02, 0x00] + list(b"Snare")),
  [{"kind": "name", "type": "input", "index": 1, "name": "Snare"}],
  chunks=[HDR[:5], HDR[5:] + [0x00, 0x02, 0x00, ord("S"), ord("n")], list(b"are") + [EOX]])
R("rx.split.nrpn_across_chunks", "single", [0xB0, 0x63, 0x05, 0xB0, 0x62, 0x17, 0xB0, 0x06, 0x50],
  [{"kind": "fader", "type": "input", "index": 6, "level": 80}],
  chunks=[[0xB0, 0x63], [0x05, 0xB0, 0x62, 0x17, 0xB0], [0x06, 0x50]])
R("rx.split.status_then_data", "hardware", [0x90, 0x00, 0x7F],
  [{"kind": "mute", "type": "input", "index": 1, "on": True}], chunks=[[0x90], [0x00], [0x7F]])
R("rx.nrpn.latch_persists", "hardware", [0xB0, 0x63, 0x07, 0xB0, 0x62, 0x17, 0xB0, 0x06, 0x10, 0xB0, 0x06, 0x20, 0xB0, 0x06, 0x30],
  [{"kind": "fader", "type": "input", "index": 8, "level": 16},
   {"kind": "fader", "type": "input", "index": 8, "level": 32},
   {"kind": "fader", "type": "input", "index": 8, "level": 48}], note="address latched: repeated Data Entry keeps applying to input 8")
R("rx.nrpn.ping_then_ping", "hardware", [0xB0, 0x63, 0x00, 0xB0, 0x63, 0x01],
  [{"kind": "fader_ping", "type": "input", "index": 1}, {"kind": "fader_ping", "type": "input", "index": 2}],
  note="two pings: the first 63 is emitted as a ping when the next 63 arrives (or on flush)")
R("rx.nrpn.bare_select_then_mute", "hardware", [0xB0, 0x63, 0x00, 0x90, 0x03, 0x7F],
  [{"kind": "fader_ping", "type": "input", "index": 1}, {"kind": "mute", "type": "input", "index": 4, "on": True}],
  note="a bare 63 with no 62 after it. On 2.12 the CONSOLE never originates one - this is another client's select, relayed raw - so the fader_ping event means 'somebody selected an address', not 'the desk announced a move'. The following message flushes it. Named ping_then_mute until 8 Sep 2026, which read as though the desk pings")
R("rx.nrpn.param.main_assign", "two-impl", [0xB0, 0x63, 0x00, 0xB0, 0x62, 0x18, 0xB0, 0x06, 0x7F],
  [{"kind": "param", "type": "input", "index": 1, "param": 0x18, "value": 0x7F}])
R("rx.sysex.unterminated_aborted_by_status", "hardware", HDR + [0x00, 0x02, 0x00, ord("K"), 0x90, 0x01, 0x7F],
  [{"kind": "mute", "type": "input", "index": 2, "on": True}], note="status byte aborts the SysEx; nothing emitted for it")
R("rx.sysex.foreign_ignored", "hardware", [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7, 0x90, 0x00, 0x7F],
  [{"kind": "mute", "type": "input", "index": 1, "on": True}], note="non-A&H SysEx is dropped silently")
# CC 0x78-0x7F is NOT MIDI channel mode on this desk. The 5 Sep 2026 session
# assigned a SoftKey the Custom MIDI string "B0,7F,01" and it arrived on the
# socket verbatim (§3.5), so the whole high range is ordinary user traffic and
# has to be surfaced for triggers rather than swallowed.
R("rx.cc.high_range_is_user_traffic", "hardware", [0xB0, 0x7B, 0x00, 0xB0, 0x79, 0x00, 0x90, 0x00, 0x3F],
  [{"kind": "cc", "channel": 0, "cc": 0x7B, "value": 0},
   {"kind": "cc", "channel": 0, "cc": 0x79, "value": 0},
   {"kind": "mute", "type": "input", "index": 1, "on": False}],
  note="CC 120–127 are user CCs, not channel mode; they carry no NRPN state but are reported")
R("rx.softkey.custom_midi", "hardware", [0xB0, 0x7F, 0x01],
  [{"kind": "cc", "channel": 0, "cc": 0x7F, "value": 1}],
  note="SoftKey assigned Custom MIDI 'B0,7F,01' — five presses arrived verbatim on both clients (§3.5)")
R("rx.app_cc.pilot_tone_lost", "hardware", [0xB0, 0x55, 0x00],
  [{"kind": "cc", "channel": 0, "cc": 0x55, "value": 0}],
  note="CC 85 = Pilot Tone Trigger (127 present, 0 lost). Reaches us because the desk relays every client's writes")

# Contiguity. A data entry is trusted only when its select and parameter legs
# arrived immediately before it. Messages the decoder emits nothing for are
# transparent — they cannot come from another controller's NRPN — but anything
# meaningful ends the run.
R("rx.nrpn.triple_survives_transparent_between", "inferred",
  [0xB0, 0x63, 0x00, 0x80, 0x05, 0x00, 0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7, 0xF8, 0xB0, 0x62, 0x17, 0xB0, 0x06, 0x6B],
  [{"kind": "fader", "type": "input", "index": 1, "level": 107}],
  note="note off, foreign SysEx and real-time between the legs neither flush the ping nor break the run — ONE fader event, no ping. Synthetic stream, never captured: demoted from 'hardware' on 8 Sep 2026, it was tier inflation")
R("rx.nrpn.run_broken_by_cc", "hardware",
  [0xB0, 0x63, 0x00, 0xB0, 0x7B, 0x00, 0xB0, 0x62, 0x17, 0xB0, 0x06, 0x6B],
  [{"kind": "fader_ping", "type": "input", "index": 1},
   {"kind": "cc", "channel": 0, "cc": 0x7B, "value": 0}],
  note="a real CC between the legs ends the run: the data entry is an orphan and is dropped, the bare select surfaces as a ping")
R("rx.nrpn.orphan_data_entry_dropped", "hardware",
  [0xB0, 0x63, 0x00, 0xB0, 0x62, 0x17, 0xB0, 0x06, 0x6B, 0x90, 0x01, 0x7F, 0xB0, 0x62, 0x17, 0xB0, 0x06, 0x40],
  [{"kind": "fader", "type": "input", "index": 1, "level": 107},
   {"kind": "mute", "type": "input", "index": 2, "on": True}],
  note="THE phantom (§3.2): the desk relays another client's partial NRPN verbatim. The second 62/06 pair has no select of its own, so it is dropped instead of being combined with the stale address — that combination invented 'Input 128 → LV 107' on the desk")
# MIDI Strips (§3.5, Firmware Reference V2.1 §10.2). The factory template's
# default messages, confirmed on the socket. Channels 2-3 are FIXED — whether
# they follow the Global base channel is untested — and on base channel 1 they
# collide with the groups and aux channels, which is how a strip fader used to
# vanish into Bank Select MSB.
R("rx.strip.mute_key", "hardware", [0x91, 0x00, 0x7F],
  [{"kind": "strip_key", "strip": 1, "key": "mute", "on": True}], midi_strips=True,
  note="strip 1 mute key; same bytes as a group 1 mute on base channel 1")
R("rx.strip.fader", "hardware", [0xB1, 0x00, 0x6B],
  [{"kind": "strip_fader", "strip": 1, "value": 107}], midi_strips=True,
  note="strip 1 fader, 7-bit streaming; reads as Bank Select MSB on the groups channel without the strip rule")
R("rx.strip.rotary_pan", "hardware", [0xB2, 0x21, 0x40],
  [{"kind": "strip_rotary", "strip": 2, "rotary": "pan", "value": 64}], midi_strips=True,
  note="rotary Pan block starts at CC 0x20 on channel 3")
R("rx.strip.off_by_default", "hardware", [0xB1, 0x00, 0x6B],
  [{"kind": "unknown", "status": 0xB1, "data": [0x00, 0x6B]}],
  note="the same bytes with strips off, base channel 12: outside the protocol window, reported as unknown rather than guessed at",
  base=12)
# §3.2: what a fader move actually looks like on the wire. The desk streams
# ~16 of these in 0.3 s, in running status, complete with the level - not the
# lone `63` ping that firmware 1.94 sent and that query-on-ping was built for.
R("rx.broadcast.fader_triple_running_status", "hardware",
  [0xB0, 0x63, 0x00, 0x62, 0x17, 0x06, 0x6B],
  [{"kind": "fader", "type": "input", "index": 1, "level": 107}],
  note="running status: one B0, then the three legs. Zero lone pings appeared in 40,000 records on 2.12")
R("rx.broadcast.fader_stream_repeats_data_entry", "hardware",
  [0xB0, 0x63, 0x00, 0x62, 0x17, 0x06, 0x60, 0x06, 0x65, 0x06, 0x6B],
  [{"kind": "fader", "type": "input", "index": 1, "level": 96},
   {"kind": "fader", "type": "input", "index": 1, "level": 101},
   {"kind": "fader", "type": "input", "index": 1, "level": 107}],
  note="a data entry may repeat while the run is unbroken - that is how a move streams without re-sending the address")
# Rule 11: the console relays other clients' Get REQUESTS, not just replies,
# so op 05 arrives from the console in both of its meanings.
R("rx.get.relayed_fader_ignored", "hardware", sysex(0, [0x05, 0x0B, 0x17, 0x00]) + [0x90, 0x00, 0x7F],
  [{"kind": "mute", "type": "input", "index": 1, "on": True}],
  note="another client's Get Fader, relayed raw. Five-byte body, so it cannot be a colour reply (always four) - dropped, and the stream continues")
R("rx.get.relayed_send_level_ignored", "hardware", sysex(0, [0x05, 0x0F, 0x0D, 0x00, 0x02, 0x00]),
  [], note="another client's Get Send Level: seven-byte body, dropped")
R("rx.get.relayed_mute_high_channel_ignored", "hardware", sysex(0, [0x05, 0x09, 0x40]),
  [], note="Get Mute for input 65. Four bytes, so it collides with a colour reply for input 10 - but 0x40 is not a colour (00-07), so it is unambiguously a Get")
R("rx.colour.reply_input10_survives_the_ambiguity", "hardware", sysex(0, [0x05, 0x09, 0x03]),
  [{"kind": "colour", "type": "input", "index": 10, "colour": "yellow"}],
  note="THE irreducible case: identical bytes to a relayed Get Mute for input 4. Read as the colour reply - losing real colours for one input is worse than a rare spurious one, and a Get brings its own reply")
R("rx.send_level.reply", "hardware", send_level(0, "input", 1, "mono_aux", 1, 107),
  [{"kind": "send_level", "type": "input", "index": 1, "dest_type": "mono_aux", "dest_index": 1, "level": 107}])
R("rx.mix_assign.reply", "inferred", mix_assign(0, 1, "mono_group", 1, True),
  [{"kind": "mix_assign", "index": 1, "dest_type": "mono_group", "dest_index": 1, "on": True}])
R("rx.preamp_gain.reply", "hardware", [0xE0, 0x00, 0x40],
  [{"kind": "preamp_gain", "bank": "mixrack", "socket": 1, "value": 64}],
  note="the gain Get answers with a pitch bend: socket in the LSB position, gain in the MSB. A library that folds pitch bend into one 14-bit value scrambles it")
R("rx.preamp_pad.reply", "hardware", sysex(0, [0x08, 0x41, 0x7F]),
  [{"kind": "preamp_pad", "bank": "dx12", "socket": 2, "on": True}],
  note="documented reply op 08; the PDF gives replies the saturated 00/7F values, not the 00-3F/40-7F set ranges")
R("rx.preamp_pad.echo_of_set", "inferred", sysex(0, [0x09, 0x41, 0x40]),
  [{"kind": "preamp_pad", "bank": "dx12", "socket": 2, "on": True}],
  note="if the console echoes the set shape instead of the documented reply, it must still decode")
R("rx.preamp_48v.reply", "hardware", sysex(0, [0x0B, 0x60, 0x00]),
  [{"kind": "preamp_48v", "bank": "dx34", "socket": 1, "on": False}],
  note="reply op 0B, confirmed on hardware")
R("rx.unknown_channel.passthrough", "hardware", [0x90 | 9, 0x00, 0x7F, 0x90, 0x00, 0x7F],
  [{"kind": "unknown", "status": 0x99, "data": [0, 127]}, {"kind": "mute", "type": "input", "index": 1, "on": True}],
  note="MIDI channel 10 is outside N..N+4 for base 1 → reported as unknown, stream continues")
R("rx.note_off.ignored", "hardware", [0x80, 0x00, 0x00, 0x90, 0x00, 0x7F],
  [{"kind": "mute", "type": "input", "index": 1, "on": True}])
R("rx.burst.running_status_with_clock", "single", [0x90] + sum(([0x24 + (i % 24), 0x7F if i % 2 == 0 else 0x3F] + ([0xF8] if i == 3 else []) for i in range(8)), []),
  [{"kind": "mute", "type": "input", "index": 0x24 + (i % 24) + 1, "on": i % 2 == 0} for i in range(8)],
  note="the Virtual dLive's running_status_burst shape (8 notes, clock spliced after the 4th). Velocities are 7F/3F: 00 would be a note-off terminator, not a mute-off.")

out = {"schema": "dlive-fixtures/1", "source": "docs/protocol.md",
       "note": "Authority for both codecs. Tiers: hardware > two-impl > single > inferred (see docs/protocol.md)."}
(HERE / "tx.json").write_text(json.dumps({**out, "cases": tx}, indent=1) + "\n")
(HERE / "rx.json").write_text(json.dumps({**out, "cases": rx}, indent=1) + "\n")
print(f"tx: {len(tx)} cases, rx: {len(rx)} cases")
