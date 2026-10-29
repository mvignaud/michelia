"""Génère les images de la PWA (public/icones, public/demarrage) depuis les PNG d'app/assets.

Lancer depuis app/ : python3 assets/brand/pwa.py (prérequis : pip install pillow).
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.dirname(HERE)
PUBLIC = os.path.join(os.path.dirname(ASSETS), "public")
BRIQUE = (122, 46, 29)


def asset(name):
    return Image.open(os.path.join(ASSETS, name)).convert("RGBA")


def save(im, *path):
    out = os.path.join(PUBLIC, *path)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.convert("RGB").save(out, optimize=True)


icone = asset("icon.png")
for size in (180, 192, 512):
    save(icone.resize((size, size), Image.LANCZOS), "icones", f"icone-{size}.png")

# Icône « maskable » : le fond et le premier plan Android, déjà dessinés pour la zone sûre.
masque = asset("android-icon-background.png")
masque.alpha_composite(asset("android-icon-foreground.png"))
for size in (192, 512):
    save(masque.resize((size, size), Image.LANCZOS), "icones", f"maskable-{size}.png")

# Écrans de démarrage iOS (portrait) : largeur, hauteur en points CSS et densité.
ECRANS = [
    (440, 956, 3), (402, 874, 3), (430, 932, 3), (393, 852, 3), (428, 926, 3),
    (390, 844, 3), (375, 812, 3), (414, 896, 3), (414, 896, 2), (414, 736, 3),
    (375, 667, 2), (320, 568, 2),
    (1032, 1376, 2), (1024, 1366, 2), (834, 1210, 2), (834, 1194, 2), (820, 1180, 2),
    (810, 1080, 2), (768, 1024, 2), (744, 1133, 2),
]
logo = asset("splash-icon.png")
for w, h, dpr in ECRANS:
    W, H = w * dpr, h * dpr
    im = Image.new("RGBA", (W, H), BRIQUE + (255,))
    side = int(min(W, H) * 0.42)
    l = logo.resize((side, side), Image.LANCZOS)
    im.alpha_composite(l, ((W - side) // 2, (H - side) // 2))
    save(im, "demarrage", f"{W}x{H}.png")

for w, h, dpr in ECRANS:
    print(
        f'<link rel="apple-touch-startup-image" href="/demarrage/{w*dpr}x{h*dpr}.png" '
        f'media="(device-width: {w}px) and (device-height: {h}px) and '
        f'(-webkit-device-pixel-ratio: {dpr}) and (orientation: portrait)">'
    )
