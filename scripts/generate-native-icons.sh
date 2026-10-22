#!/usr/bin/env bash
# Regenerates the iOS and Android launcher icons from assets/icon.svg and
# assets/icon-foreground.svg. Requires rsvg-convert (brew install librsvg)
# and python3 with Pillow.
set -euo pipefail

cd "$(dirname "$0")/.."

BRAND='#3360E2'
FULL=assets/icon.svg
FG=assets/icon-foreground.svg
RES=android/app/src/main/res
IOS=ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# iOS: one opaque, square-cornered 1024px icon. iOS applies its own mask,
# and rejects icons with an alpha channel.
rsvg-convert -w 1024 -h 1024 -b "$BRAND" "$FULL" -o "$TMP/ios.png"
python3 - "$TMP/ios.png" "$IOS" <<'PY'
import sys
from PIL import Image
Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2], optimize=True)
PY

# Android: adaptive foreground at 108dp per density, legacy square and round
# icons at 48dp for API 24-25.
for pair in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  density=${pair%%:*}
  scale=${pair##*:}
  dir="$RES/mipmap-$density"
  fg=$(python3 -c "print(round(108 * $scale))")
  legacy=$(python3 -c "print(round(48 * $scale))")

  rsvg-convert -w "$fg" -h "$fg" "$FG" -o "$dir/ic_launcher_foreground.png"
  rsvg-convert -w "$legacy" -h "$legacy" -b "$BRAND" "$FULL" -o "$TMP/full.png"

  python3 - "$TMP/full.png" "$dir" <<'PY'
import sys
from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
full = Image.open(src).convert("RGBA")
size = full.width
# Supersample the masks so the edges are antialiased.
big = size * 8

def masked(draw_shape, name):
    mask = Image.new("L", (big, big), 0)
    draw_shape(ImageDraw.Draw(mask))
    icon = full.copy()
    icon.putalpha(mask.resize((size, size), Image.LANCZOS))
    icon.save(f"{out}/{name}", optimize=True)

# Same rounded square as public/icons/icon-512.png (18.9% corner radius).
masked(lambda d: d.rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * 0.189), fill=255),
       "ic_launcher.png")
masked(lambda d: d.ellipse((0, 0, big - 1, big - 1), fill=255), "ic_launcher_round.png")
PY
done

# Splash screens: the white route glyph centred on brand blue, sized so its
# ink spans ~30% of the screen's short side on a phone.
splash_svg() { # width height ink_px
  python3 - "$@" <<'PY'
import sys
w, h, ink = (float(v) for v in sys.argv[1:])
s = ink / 19.8  # the glyph's ink spans 19.8 of lucide's 24 units, centred on 12
print(f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w:g}" height="{h:g}" viewBox="0 0 {w:g} {h:g}">
  <rect width="{w:g}" height="{h:g}" fill="#3360E2"/>
  <g transform="translate({w/2 - 12*s:.2f} {h/2 - 12*s:.2f}) scale({s:.4f})" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="6" cy="19" r="3"/>
    <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>
    <circle cx="18" cy="5" r="3"/>
  </g>
</svg>''')
PY
}

render_opaque() { # svg_file out_png
  rsvg-convert "$1" -o "$TMP/splash.png"
  python3 -c "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2], optimize=True)" \
    "$TMP/splash.png" "$2"
}

# iOS aspect-fills a 2732px square, so on a portrait phone only the middle
# ~46% of its width is visible. 13.8% of the square ≈ 30% of phone width.
splash_svg 2732 2732 377 > "$TMP/ios-splash.svg"
for f in splash-2732x2732.png splash-2732x2732-1.png splash-2732x2732-2.png; do
  render_opaque "$TMP/ios-splash.svg" "ios/App/App/Assets.xcassets/Splash.imageset/$f"
done

# Android (pre-12) stretches splash.png to the screen, so each file keeps its
# own aspect ratio and the glyph stays round.
for f in "$RES"/drawable/splash.png "$RES"/drawable-*/splash.png; do
  read -r w h < <(sips -g pixelWidth -g pixelHeight "$f" | awk '/pixel/ {v = v $2 " "} END {print v}')
  short=$(( w < h ? w : h ))
  splash_svg "$w" "$h" "$(( short * 30 / 100 ))" > "$TMP/android-splash.svg"
  render_opaque "$TMP/android-splash.svg" "$f"
done

echo "Icons written to $IOS and $RES/mipmap-*; splash screens regenerated"
