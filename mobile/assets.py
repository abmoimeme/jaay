# Writes the Jaay icon and launch screen into the iOS and Android projects. Run after "npx cap add": python3 assets.py
import io, re, subprocess, glob, os
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__)); INDIGO = (0x1E, 0x2A, 0x5A)
svg = open(os.path.join(HERE, '..', 'brand', 'jaay-icon.svg')).read()
def render(s, px):
    out = subprocess.run(['rsvg-convert', '-w', str(px), '-h', str(px)], input=s.encode(), capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(out)).convert('RGBA')
square = svg.replace('rx="28" fill="#1E2A5A"', 'fill="#1E2A5A"', 1)            # full-bleed (the stores round the corners)
glyph = re.sub(r'<rect width="120" height="120" rx="28" fill="#1E2A5A"/>', '', svg, 1)  # no background
assert square != svg and glyph != svg
def flat(im): bg = Image.new('RGB', im.size, INDIGO); bg.paste(im, mask=im.split()[3]); return bg
# iOS: one 1024 icon, no transparency
flat(render(square, 1024)).save(os.path.join(HERE, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'))
# Android: legacy, round and adaptive foreground
res = os.path.join(HERE, 'android/app/src/main/res')
for d, px in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
    render(svg, px).save(f'{res}/mipmap-{d}/ic_launcher.png')
    sq = render(square, px); m = Image.new('L', (px, px), 0); ImageDraw.Draw(m).ellipse((0, 0, px - 1, px - 1), fill=255); r = Image.new('RGBA', (px, px), (0, 0, 0, 0)); r.paste(sq, mask=m); r.save(f'{res}/mipmap-{d}/ic_launcher_round.png')
    fpx = px * 108 // 48; g = render(glyph, int(fpx * 0.78)); f = Image.new('RGBA', (fpx, fpx), (0, 0, 0, 0)); f.paste(g, ((fpx - g.width) // 2, (fpx - g.height) // 2), g); f.save(f'{res}/mipmap-{d}/ic_launcher_foreground.png')
open(f'{res}/values/ic_launcher_background.xml', 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1E2A5A</color>\n</resources>\n')
# Launch screens: indigo with the mark in the middle
def splash(w, h):
    im = Image.new('RGB', (w, h), INDIGO); px = min(w, h) // 4; g = render(glyph, px); im.paste(g, ((w - px) // 2, (h - px) // 2), g); return im
for f in glob.glob(f'{res}/drawable*/splash.png'):
    w, h = Image.open(f).size; splash(w, h).save(f)
for f in glob.glob(os.path.join(HERE, 'ios/App/App/Assets.xcassets/Splash.imageset/*.png')): splash(2732, 2732).save(f)
print('icons and launch screens written')
