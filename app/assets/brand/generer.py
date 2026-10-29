"""Génère l'identité visuelle MichelIA en SVG (sortie : ./out/*.svg).

Police du logotype : Fraunces 800 (licence OFL), vectorisée dans les SVG.
Prérequis : pip install fonttools brotli ; npm pack @fontsource/fraunces
puis décompresser l'archive dans ./fonts/ (FONT ci-dessous).
Les PNG d'app/assets sont rendus depuis ces SVG (Chromium, 1024 px).
"""
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)
FONT = os.path.join(HERE, "fonts", "package", "files", "fraunces-latin-800-normal.woff2")

BRIQUE = "#7A2E1D"
BRIQUE_CLAIR = "#9A3F2A"
BRIQUE_FONCE = "#5E2214"
CREME = "#FBF4E8"
ENCRE = "#2B2420"
OCRE = "#D9A441"
ROSE = "#E08A6E"
VERT = "#7E8F4E"
VERT_CLAIR = "#A3AE6A"


def text_path(text, size, x=0, y=0, font=FONT, tracking=0):
    """Renvoie (d, largeur) : le texte vectorisé, ligne de base en y."""
    f = TTFont(font)
    gs = f.getGlyphSet()
    cmap = f.getBestCmap()
    upm = f["head"].unitsPerEm
    s = size / upm
    pen = SVGPathPen(gs)
    cx = 0
    for ch in text:
        g = cmap[ord(ch)]
        tp = TransformPen(pen, (s, 0, 0, -s, x + cx, y))
        gs[g].draw(tp)
        cx += gs[g].width * s + tracking
    return pen.getCommands(), cx - tracking


# --- Michel : une bulle de discussion qui est sa tête, coiffée du béret ---
# Repère 1024 x 1024, sujet centré, tient dans le cercle utile Android (~660 px).
def michel(face=CREME, ink=ENCRE, nose=ROSE, cheek=ROSE, mono=None):
    if mono:
        # Monochrome : silhouette pleine, traits évidés via un masque
        corps = michel(face="#fff", ink="#000", nose="#000", cheek="none") + beret(fill="#000", gap=True)
        return (
            f'<mask id="evide">{corps}</mask>'
            f'<rect width="1024" height="1024" fill="{mono}" mask="url(#evide)"/>'
        )
    parts = []
    # Tête-bulle avec la queue de bulle en bas à gauche
    parts.append(
        f'<path fill="{face}" d="M512 372c150 0 250 92 250 222 0 130-100 220-250 220'
        f'-34 0-66-5-95-14l-92 56c-14 9-30-5-24-20l30-74c-44-40-69-98-69-168 0-130 100-222 250-222z"/>'
    )
    # Joues
    parts.append(f'<circle cx="398" cy="652" r="34" fill="{cheek}" opacity=".35"/>')
    parts.append(f'<circle cx="626" cy="652" r="34" fill="{cheek}" opacity=".35"/>')
    # Sourcils froncés (bougon)
    parts.append(
        f'<g stroke="{ink}" stroke-width="30" stroke-linecap="round" fill="none">'
        f'<path d="M398 528l78 22"/><path d="M626 528l-78 22"/></g>'
    )
    # Yeux
    parts.append(f'<circle cx="446" cy="590" r="17" fill="{ink}"/>')
    parts.append(f'<circle cx="578" cy="590" r="17" fill="{ink}"/>')
    # Moustache en guidon
    parts.append(
        f'<path fill="{ink}" d="M512 664c-30-16-78-22-118-4-26 12-44 34-50 58-4 14 12 22 22 12'
        f' 22-20 52-26 82-16 26 9 46 12 64 4 18 8 38 5 64-4 30-10 60-4 82 16 10 10 26 2 22-12'
        f'-6-24-24-46-50-58-40-18-88-12-118 4z"/>'
    )
    # Nez
    parts.append(f'<ellipse cx="512" cy="636" rx="40" ry="36" fill="{nose}"/>')
    if nose == "#000":
        parts.append('<ellipse cx="512" cy="636" rx="26" ry="22" fill="#fff"/>')
    parts.append(f'<ellipse cx="500" cy="624" rx="12" ry="9" fill="#fff" opacity=".35"/>')
    return "\n".join(parts)


def beret(fill=ENCRE, gap=False):
    galette = ("M268 440c-10-70 50-130 160-148 120-20 250 4 330 58 34 23 46 52 32 70"
               "-10 12-30 14-52 10-150-24-300-26-440 22-16 4-28 2-30-12z")
    if gap:
        # Liseré noir autour de la galette pour la détacher du visage
        return (f'<path d="{galette}" fill="#fff" stroke="#000" stroke-width="36"/>'
                '<path d="M520 298c4-24 18-40 34-44" stroke="#fff" stroke-width="16" stroke-linecap="round" fill="none"/>')
    return (
        # Cabillou (la petite queue du béret)
        f'<path d="M520 298c4-24 18-40 34-44" stroke="{fill}" stroke-width="16" stroke-linecap="round" fill="none"/>'
        # Galette penchée, débordant à droite
        f'<path fill="{fill}" d="M268 440c-10-70 50-130 160-148 120-20 250 4 330 58 34 23 46 52 32 70'
        f'-10 12-30 14-52 10-150-24-300-26-440 22-16 4-28 2-30-12z"/>'
    )


def head(mono=None, **kw):
    if mono:
        return michel(mono=mono)
    return michel(**kw) + "\n" + beret()


def svg(body, w=1024, h=1024, extra_defs=""):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
        f"<defs>{extra_defs}</defs>{body}</svg>\n"
    )


FOND_DEFS = (
    f'<linearGradient id="fond" x1="0" y1="0" x2="0" y2="1">'
    f'<stop offset="0" stop-color="{BRIQUE_CLAIR}"/><stop offset="1" stop-color="{BRIQUE_FONCE}"/></linearGradient>'
)


def write(name, content):
    with open(os.path.join(OUT, name), "w") as fh:
        fh.write(content)


def placer(body, x, y, s):
    return f'<g transform="translate({x} {y}) scale({s}) translate(-512 -560)">{body}</g>'


# Symbole seul, fond transparent
write("logo-symbole.svg", svg(head()))
# Symbole monochrome (Android 13+, gravures, tampons)
write("logo-monochrome.svg", svg(head(mono="#000000")))

# Icône d'appli : fond brique plein cadre (iOS ajoute ses coins)
write("icone.svg", svg(f'<rect width="1024" height="1024" fill="url(#fond)"/>' + placer(head(), 512, 548, 1.14), extra_defs=FOND_DEFS))

# Android adaptatif : premier plan réduit dans la zone sûre (66 %)
write(
    "android-premier-plan.svg",
    svg(f'<g transform="translate(512 540) scale(.82) translate(-512 -560)">{head()}</g>'),
)
write("android-fond.svg", svg('<rect width="1024" height="1024" fill="url(#fond)"/>', extra_defs=FOND_DEFS))
write(
    "android-monochrome.svg",
    svg(f'<g transform="translate(512 540) scale(.82) translate(-512 -560)">{head(mono="#000000")}</g>'),
)

# Favicon : tête cadrée serrée pour rester lisible en 16-32 px
write(
    "favicon.svg",
    svg(
        f'<rect width="1024" height="1024" rx="230" fill="{BRIQUE}"/>'
        f'<g transform="translate(512 560) scale(1.18) translate(-512 -560)">{head()}</g>'
    ),
)

# Logotype horizontal : symbole + « MichelIA »
d_michel, w_michel = text_path("Michel", 300, tracking=-6)
d_ia, w_ia = text_path("IA", 300, tracking=-6)
gap = 4
total = w_michel + gap + w_ia
logo_w = 520 + total + 40


def logotype(ink=ENCRE, accent=BRIQUE, face=CREME):
    return (
        f'<rect x="40" y="110" width="440" height="440" rx="100" fill="{BRIQUE if accent != OCRE else BRIQUE_FONCE}"/>'
        f'<g transform="translate(262 340) scale(.62) translate(-512 -560)">{michel(face=CREME)}{beret(fill=ENCRE)}</g>'
        f'<g transform="translate(540 0)"><path fill="{ink}" d="{text_path("Michel", 300, 0, 470, tracking=-6)[0]}"/>'
        f'<path fill="{accent}" d="{text_path("IA", 300, w_michel + gap, 470, tracking=-6)[0]}"/></g>'
    )


write("logo-horizontal.svg", svg(logotype(), w=int(540 + total + 40), h=660))
write(
    "logo-horizontal-negatif.svg",
    svg(f'<rect width="100%" height="100%" fill="{BRIQUE}"/>' + logotype(ink=CREME, accent=OCRE, face=CREME),
        w=int(540 + total + 40), h=660),
)

# Écran de démarrage : symbole seul (Expo le pose sur la couleur de fond)
write("splash.svg", svg(placer(head(), 512, 548, 1.5)))

# --- Illustrations d'accueil (3 écrans), format 1080 x 1080, paysage gersois ---
COLLINES = (
    f'<path fill="{VERT_CLAIR}" d="M0 760c160-60 300-70 460-30s320 40 620-40v390H0z"/>'
    f'<path fill="{VERT}" d="M0 860c200-50 380-40 560 0s340 20 520-30v290H0z"/>'
    # Rangées de tournesols stylisées
    + "".join(
        f'<circle cx="{x}" cy="{y}" r="9" fill="{OCRE}"/>'
        for y, xs in ((960, range(60, 1080, 70)), (1030, range(25, 1080, 70)))
        for x in xs
    )
)


def soleil(cx=820, cy=300, r=110):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{OCRE}" opacity=".9"/>'


def scene(fg, ciel=CREME):
    return svg(f'<rect width="1080" height="1080" fill="{ciel}"/>{soleil()}{COLLINES}{fg}', 1080, 1080)


def placer(body, x, y, s):
    return f'<g transform="translate({x} {y}) scale({s}) translate(-512 -560)">{body}</g>'


# 1. « Adieu ! » : Michel salue, main levée
main = (
    f'<g transform="translate(250 330) rotate(-18)">'
    f'<rect x="-40" y="-70" width="80" height="120" rx="40" fill="{CREME}" stroke="{ENCRE}" stroke-width="14"/>'
    f'<path d="M-40 -20h-20" stroke="{ENCRE}" stroke-width="14" stroke-linecap="round"/></g>'
)
bulle_adieu = (
    f'<g transform="translate(650 150)"><rect x="0" y="0" width="300" height="130" rx="65" fill="{BRIQUE}"/>'
    f'<path d="M60 120l-30 50 70-40z" fill="{BRIQUE}"/>'
    f'<path fill="{CREME}" d="{text_path("Adieu !", 70, 52, 90)[0]}"/></g>'
)
write("accueil-1-adieu.svg", svg(f'<rect width="1080" height="1080" fill="{CREME}"/>{soleil(540, 560, 330)}{COLLINES}'
    + placer(head(), 540, 580, .8) + bulle_adieu, 1080, 1080))

# 2. « Demande-moi » : bulles de questions autour de Michel
bulles = "".join(
    f'<g transform="translate({x} {y})"><rect width="{w}" height="90" rx="45" fill="{c}"/>'
    f'<path fill="{t}" d="{text_path(s, 52, 34, 64)[0]}"/></g>'
    for x, y, w, s, c, t in (
        (90, 150, 300, "Recette ?", CREME, ENCRE),
        (640, 120, 330, "Un mail ?", BRIQUE, CREME),
        (110, 330, 250, "Météo ?", BRIQUE, CREME),
        (680, 310, 310, "Devoirs ?", CREME, ENCRE),
    )
)
write(
    "accueil-2-demande.svg",
    svg(
        f'<rect width="1080" height="1080" fill="{OCRE}" opacity=".35"/>'
        f'<rect width="1080" height="1080" fill="{CREME}" opacity=".55"/>{COLLINES}'
        + soleil(540, 600, 300) + placer(head(), 540, 620, .8)
        + bulles.replace(f'rx="45" fill="{CREME}"/>', f'rx="45" fill="{CREME}" stroke="{ENCRE}" stroke-width="6"/>'),
        1080,
        1080,
    ),
)

# 3. « Bientôt la voix » : Michel et ondes sonores, ciel du soir
ondes = "".join(
    f'<path d="M{790 + i * 46} {600 - h} v{2 * h}" stroke="{CREME}" stroke-width="22" stroke-linecap="round"/>'
    for i, h in enumerate((40, 90, 140, 80, 30))
) + "".join(
    f'<path d="M{290 - i * 46} {600 - h} v{2 * h}" stroke="{CREME}" stroke-width="22" stroke-linecap="round"/>'
    for i, h in enumerate((40, 90, 140, 80, 30))
)
write(
    "accueil-3-voix.svg",
    svg(
        f'<defs><linearGradient id="soir" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{BRIQUE_FONCE}"/><stop offset=".7" stop-color="{BRIQUE_CLAIR}"/>'
        f'<stop offset="1" stop-color="{OCRE}"/></linearGradient></defs>'
        f'<rect width="1080" height="1080" fill="url(#soir)"/>{soleil(540, 760, 170)}{COLLINES}{ondes}'
        + placer(head(), 540, 560, .78),
        1080,
        1080,
    ),
)
print("ok", sorted(os.listdir(OUT)))

# Image de partage (réseaux sociaux, aperçu de lien) 1200 x 630
d_tag, w_tag = text_path("Le papi gersois coincé dans l'ordi", 44)
neg_w = 540 + total + 40
write(
    "partage.svg",
    svg(
        f'<rect width="1200" height="630" fill="url(#fond)"/>'
        f'<g transform="translate({(1200 - neg_w * .5) / 2:.0f} 120) scale(.5)">{logotype(ink=CREME, accent=OCRE)}</g>'
        f'<path fill="{CREME}" opacity=".85" transform="translate({(1200 - w_tag) / 2:.0f} 0)" d="{text_path("Le papi gersois coincé dans l&apos;ordi".replace("&apos;", chr(8217)), 44, 0, 540)[0]}"/>',
        1200, 630, extra_defs=FOND_DEFS,
    ),
)
