#!/usr/bin/python3
"""
Renders the dylanmaudio apps' logos and menu-bar icons into
src/control/looks/images.ts (base64 PNG), for the module's layered presets.

    /usr/bin/python3 tools/app-images.py [path/to/dLive Utility Apps]

Needs macOS's own Python, which carries AppKit (PyObjC), and `sips`.

Logos come from each app's icon set, scaled down with sips. The menu-bar
icons are redrawn here from the apps' own geometry and colours, at 8x, so
they stay sharp on a Stream Deck key. The drawing code is a port of these
functions, and must follow them when they change:

    apps/midi-bridge/webview_app.py         _draw_indicator, _draw_fader, _draw_bang, COLOURS
    apps/pilot-tone-trigger/webview_app.py  _make_wave_icon, ICON_COLOURS
    apps/talk-light-trigger/webview_app.py  _make_bar_icon, ICON_COLOURS
    apps/time-code-tool/webview_app.py      _make_bar_icon, ICON_COLOURS

Console Control is a window app with no menu-bar icon, so it has a logo only.
"""
import base64
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from AppKit import (
    NSBezierPath,
    NSBitmapImageRep,
    NSColor,
    NSDeviceRGBColorSpace,
    NSGraphicsContext,
    NSPNGFileType,
)
from Foundation import NSAffineTransform, NSMakeRect

SCALE = 8
LOGO_PX = 144
MODULE = Path(__file__).resolve().parent.parent
MONOREPO = Path(sys.argv[1]) if len(sys.argv) > 1 else MODULE.parent / "dLive Utility Apps"
OUT = MODULE / "src" / "control" / "looks" / "images.ts"

LOGOS = {
    "bridge": "apps/midi-bridge/assets/MIDI Bridge - dLive.iconset/icon_128x128@2x.png",
    "tlt": "apps/talk-light-trigger/packaging/assets/dLive TLT.iconset/icon_128x128@2x.png",
    "ptt": "apps/pilot-tone-trigger/packaging/assets/dLive PTT.iconset/icon_128x128@2x.png",
    "tct": "apps/time-code-tool/packaging/assets/Time Code Tool.iconset/icon_128x128@2x.png",
    "cxc": "apps/console-control/packaging/assets/icon-1024-master.png",
}


def rgb(hexs):
    hexs = hexs.lstrip("#")
    return tuple(int(hexs[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def set_colour(c, alpha=1.0):
    NSColor.colorWithCalibratedRed_green_blue_alpha_(c[0], c[1], c[2], alpha).set()


def render(w, h, draw):
    """Draw in the app's own point coordinates onto a bitmap SCALE times larger."""
    rep = NSBitmapImageRep.alloc().initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel_(
        None, int(w * SCALE), int(h * SCALE), 8, 4, True, False, NSDeviceRGBColorSpace, 0, 0)
    ctx = NSGraphicsContext.graphicsContextWithBitmapImageRep_(rep)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.setCurrentContext_(ctx)
    t = NSAffineTransform.transform()
    t.scaleBy_(SCALE)
    t.concat()
    draw()
    ctx.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    return bytes(rep.representationUsingType_properties_(NSPNGFileType, {}))


# ---------------------------------------------------------------- MIDI Bridge
MB = {
    "stopped_outline": (0.55, 0.55, 0.58),
    "not_connected": (0.86, 0.25, 0.25),
    "connecting": (0.94, 0.68, 0.09),
    "connected": (0.22, 0.72, 0.35),
    "error": (0.94, 0.68, 0.09),
    "halo": (0.35, 0.85, 0.88),
}
KNOCKOUT = (0.11, 0.11, 0.13)
GLYPH = 18


def mb_fader(c, alpha):
    set_colour(c, alpha)
    cx = GLYPH / 2.0
    lane_h, lane_w = 7.0, 1.2
    lane_y = (GLYPH - lane_h) / 2.0
    knob_w, knob_h = 3.2, 2.0
    for dx, frac in ((-2.2, 0.30), (2.2, 0.68)):
        NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(
            NSMakeRect(cx + dx - lane_w / 2.0, lane_y, lane_w, lane_h), 0.6, 0.6).fill()
        ky = lane_y + frac * (lane_h - knob_h)
        NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(
            NSMakeRect(cx + dx - knob_w / 2.0, ky, knob_w, knob_h), 1.0, 1.0).fill()


def mb_bang(c):
    set_colour(c)
    cx = GLYPH / 2.0
    NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(NSMakeRect(cx - 0.9, 7.0, 1.8, 5.0), 0.9, 0.9).fill()
    NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(cx - 1.0, 3.6, 2.0, 2.0)).fill()


def mb(state, flash=0.0):
    def draw():
        inset = 2.5
        disc = NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(inset, inset, GLYPH - 2 * inset, GLYPH - 2 * inset))
        if state == "stopped":
            set_colour(MB["stopped_outline"])
            disc.setLineWidth_(1.5)
            disc.stroke()
            mb_fader(MB["stopped_outline"], 1.0)
        elif state == "error":
            set_colour(MB["error"])
            disc.fill()
            mb_bang(KNOCKOUT)
        else:  # not_connected, connecting (shown at full breath), connected
            if flash > 0.0:
                halo = NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(0.5, 0.5, GLYPH - 1.0, GLYPH - 1.0))
                set_colour(MB["halo"], 0.85 * flash)
                halo.setLineWidth_(2.0)
                halo.stroke()
            set_colour(MB[state])
            disc.fill()
            mb_fader(KNOCKOUT, 1.0)
    return render(GLYPH, GLYPH, draw)


# ---------------------------------------------------------------- Pilot Tone
PTT = {
    "stopped": "#4A4A56",
    "ok": "#5C8FD6",
    "lost": "#E85C5C",
    "latched": "#E8A94A",
    "degraded": "#D9743F",
}


def ptt(colour):
    w, h = 22, 16

    def draw():
        path = NSBezierPath.bezierPath()
        n, x0, x1, cy, amp = 40, 2.0, w - 2.0, h / 2.0, 4.5
        for i in range(n + 1):
            t = i / n
            pt = (x0 + (x1 - x0) * t, cy + amp * math.sin(t * 2 * math.pi * 2))
            path.moveToPoint_(pt) if i == 0 else path.lineToPoint_(pt)
        path.setLineWidth_(2.0)
        path.setLineCapStyle_(1)  # round
        path.setLineJoinStyle_(1)  # round
        set_colour(rgb(colour))
        path.stroke()
    return render(w, h, draw)


# ---------------------------------------------------------------- Talk Light
TLT = {"stopped": "#4A4A56", "quiet": "#5C8FD6", "active": "#E8F0FF"}


def tlt(colour):
    w, h, bar_w, gap, heights = 20, 16, 3, 2, (5, 9, 6)

    def draw():
        set_colour(rgb(colour))
        x = (w - (len(heights) * bar_w + (len(heights) - 1) * gap)) / 2.0
        for bh in heights:
            NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(NSMakeRect(x, (h - bh) / 2.0, bar_w, bh), 1, 1).fill()
            x += bar_w + gap
    return render(w, h, draw)


# ---------------------------------------------------------------- Time Code Tool
TCT = {"stopped": "#4A4A56", "no_signal": "#4A4A56", "locked": "#3FB65C", "freewheel": "#E0A93F",
       "clip": "#E8503F", "generating": "#3FB65C"}


def tct(colour):
    w, h, bar_w, bar_h, dot, gap = 20, 16, 2.5, 10.0, 1.5, 1.5

    def draw():
        set_colour(rgb(colour))

        def bar(x):
            NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(NSMakeRect(x, (h - bar_h) / 2.0, bar_w, bar_h), 1, 1).fill()

        def colon(x):
            for cy in (h / 2.0 + 1.5, h / 2.0 - 3.5):
                NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(x, cy, dot, dot)).fill()
        x = (w - (3 * bar_w + 2 * dot + 4 * gap)) / 2.0
        bar(x); x += bar_w + gap
        colon(x); x += dot + gap
        bar(x); x += bar_w + gap
        colon(x); x += dot + gap
        bar(x)
    return render(w, h, draw)


def logo(rel):
    src = MONOREPO / rel
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "logo.png"
        subprocess.run(["sips", "-Z", str(LOGO_PX), str(src), "--out", str(out)], check=True, capture_output=True)
        return out.read_bytes()


def b64(data):
    return base64.b64encode(data).decode("ascii")


def main():
    if not MONOREPO.is_dir():
        sys.exit(f"monorepo not found at {MONOREPO} — pass its path")
    logos = {app: logo(rel) for app, rel in LOGOS.items()}
    menubar = {
        "bridge": {**{s: mb(s) for s in ("stopped", "not_connected", "connecting", "connected", "error")},
                   "activity": mb("connected", flash=1.0)},
        "ptt": {s: ptt(c) for s, c in PTT.items()},
        "tlt": {s: tlt(c) for s, c in TLT.items()},
        "tct": {s: tct(c) for s, c in TCT.items()},
    }
    lines = [
        "// Generated by tools/app-images.py from the dylanmaudio monorepo — do not edit.",
        "// Logos from each app's icon set; menu-bar icons redrawn from the apps' own geometry at 8x.",
        "",
        "/** Each app's logo, 144 px PNG, base64. */",
        "export const APP_LOGOS: Record<'bridge' | 'tlt' | 'ptt' | 'tct' | 'cxc', string> = {",
    ]
    lines += [f"\t{app}: '{b64(png)}'," for app, png in logos.items()]
    lines += ["}", "", "/** Each menu-bar app's icon in every state it shows, PNG, base64. */", "export const MENUBAR_ICONS = {"]
    for app, states in menubar.items():
        lines.append(f"\t{app}: {{")
        lines += [f"\t\t{s}: '{b64(png)}'," for s, png in states.items()]
        lines.append("\t},")
    lines += ["} as const", ""]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines))
    sizes = {app: len(png) for app, png in logos.items()}
    print(f"wrote {OUT.relative_to(MODULE)}: {OUT.stat().st_size // 1024} KB; logos {sizes}; "
          f"menubar {{{', '.join(f'{a}: {len(s)}' for a, s in menubar.items())}}}")


if __name__ == "__main__":
    main()
