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

echo "Icons written to $IOS and $RES/mipmap-*"
