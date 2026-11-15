#!/usr/bin/env python3
"""
Builds Jaxongirman Sans, the app's interface face, into user/assets/fonts/.

    python3 -m venv /tmp/fm && /tmp/fm/bin/pip install fonttools
    /tmp/fm/bin/python user/scripts/build-ui-font.py

The interface is set in Bricolage Grotesque, the face of jaxongirman.app. It
draws Latin — Uzbek in both alphabets, Ö Ğ Ş Ç included — but no Cyrillic, and
the app also speaks Russian. Left alone, every Russian word would fall back to
whatever the platform has (Times, on the web). So each weight here is
Bricolage Grotesque with Manrope's Cyrillic added: Manrope is the face the app
used before and draws Cyrillic well. Its letters are scaled to stand as tall as
Bricolage's, and everything Bricolage already draws — and its line height and
baseline — stays Bricolage.

Both faces are under the SIL Open Font License 1.1 with no Reserved Font Name;
the result is OFL too (assets/fonts/OFL.txt) and carries its own name, as the
licence asks of a modified font.
"""
import os

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib.scaleUpem import scale_upem
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
MODULES = os.path.join(HERE, "..", "..", "node_modules", "@expo-google-fonts")
OUT = os.path.join(HERE, "..", "assets", "fonts")

WEIGHTS = ["400Regular", "500Medium", "600SemiBold", "700Bold", "800ExtraBold"]
CYRILLIC = list(range(0x0400, 0x0530))
FAMILY = "Jaxongirman Sans"


def cyrillic_from_manrope(path, bricolage):
    font = TTFont(path)
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=CYRILLIC)
    subsetter.subset(font)
    # Same em as Bricolage, capitals the same height: shrink the outlines by
    # Bricolage's cap height over Manrope's, then call the em 1000.
    # Sized between matching the capitals (660/1440) and the lowercase
    # (525/1080), since Russian text is mostly lowercase and its headings are
    # not. scale_upem multiplies every coordinate by new/old, so asking for
    # 2000 × that ratio (≈ 944 units) shrinks the letters to the right size.
    caps = bricolage["OS/2"].sCapHeight / font["OS/2"].sCapHeight
    lower = bricolage["OS/2"].sxHeight / font["OS/2"].sxHeight
    ratio = (caps * lower) ** 0.5
    scale_upem(font, round(font["head"].unitsPerEm * ratio))
    font["head"].unitsPerEm = 1000
    for table in ("STAT", "GDEF"):
        if table in font:
            del font[table]
    return font


def rename(font, weight_name):
    style = {"400Regular": "Regular", "500Medium": "Medium", "600SemiBold": "SemiBold",
             "700Bold": "Bold", "800ExtraBold": "ExtraBold"}[weight_name]
    names = font["name"]
    postscript = f"JaxongirmanSans-{style}"
    for record in list(names.names):
        if record.nameID in (1, 4, 6, 16, 17, 3, 25):
            names.removeNames(nameID=record.nameID)
    names.setName(FAMILY if style in ("Regular", "Bold") else f"{FAMILY} {style}", 1, 3, 1, 0x409)
    names.setName(style if style in ("Regular", "Bold") else "Regular", 2, 3, 1, 0x409)
    names.setName(f"{FAMILY} {style}", 4, 3, 1, 0x409)
    names.setName(postscript, 6, 3, 1, 0x409)
    names.setName(FAMILY, 16, 3, 1, 0x409)
    names.setName(style, 17, 3, 1, 0x409)
    names.setName(f"{postscript};Bricolage Grotesque + Manrope Cyrillic", 3, 3, 1, 0x409)


def build(weight):
    bricolage_path = os.path.join(MODULES, "bricolage-grotesque", weight, f"BricolageGrotesque_{weight}.ttf")
    manrope_path = os.path.join(MODULES, "manrope", weight, f"Manrope_{weight}.ttf")
    bricolage = TTFont(bricolage_path)
    for table in ("STAT", "GDEF"):
        if table in bricolage:
            del bricolage[table]
    cyrillic = cyrillic_from_manrope(manrope_path, bricolage)

    work = os.path.join(OUT, ".work")
    os.makedirs(work, exist_ok=True)
    first, second = os.path.join(work, "a.ttf"), os.path.join(work, "b.ttf")
    bricolage.save(first)
    cyrillic.save(second)
    merged = Merger().merge([first, second])
    # Line height and baseline stay exactly Bricolage's: the merger takes the
    # larger of the two faces' extents, which would move every line of text.
    original = TTFont(bricolage_path)
    for field in ("ascent", "descent", "lineGap"):
        setattr(merged["hhea"], field, getattr(original["hhea"], field))
    for field in ("sTypoAscender", "sTypoDescender", "sTypoLineGap", "usWinAscent", "usWinDescent", "sxHeight", "sCapHeight", "fsSelection"):
        setattr(merged["OS/2"], field, getattr(original["OS/2"], field))
    rename(merged, weight)
    target = os.path.join(OUT, f"JaxongirmanSans-{weight}.ttf")
    merged.save(target)
    os.remove(first)
    os.remove(second)
    os.rmdir(work)
    cmap = merged.getBestCmap()
    # Uzbek is shown in Latin; Manrope never drew Қ Ғ Ҳ either.
    missing = [c for c in "ÖöĞğŞşÇçО‘о‘АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя" if ord(c) not in cmap]
    if missing:
        raise SystemExit(f"{os.path.basename(target)} is missing {''.join(missing)}")
    print(f"{os.path.basename(target)}: {merged['maxp'].numGlyphs} glyphs, updated Uzbek Latin and Russian drawn")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for weight in WEIGHTS:
        build(weight)
