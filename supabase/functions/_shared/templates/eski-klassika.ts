import type { Slot, SlideTemplate } from "../design-types.ts";

/**
 * The measurements a text band takes. Both `display` and `copy` read the same
 * shape and differ only in what they default to, which is what keeps the two
 * voices of this design from drifting apart.
 */
type Band = {
  x: number;
  y: number;
  width: number;
  height: number;
  align?: "left" | "center" | "right";
  role?: Parameters<typeof txt>[0];
  font?: Parameters<typeof txt>[2];
  maxLines?: number;
  minFont?: number;
  z?: number;
};
import { bleed, chart, shape, txt } from "./kit.ts";
/**
 * ESKI KLASSIKA — a typography-first editorial poster system.
 *
 * The identity is not "a blue background and two fonts". It is the combination
 * of six things, and every layout below keeps all six:
 *
 *   1. A royal cobalt sheet with a faint press texture — never flat digital blue.
 *   2. Enormous condensed capitals (Bebas) set at nearly their own line height,
 *      so a two-line headline reads as one solid block of ink.
 *   3. An elegant slanted script (Lavonia Classy) used only for a one-to-four
 *      word emotional phrase, laid over the capitals so the two touch.
 *   4. Both voices in white. Lime is decoration — a rule, a marker — never a word.
 *   5. Type running edge to edge, and large deliberate emptiness elsewhere.
 *   6. Fifteen distinct compositions, alternating loud and quiet.
 *
 * Four implementation notes worth knowing before reading the layouts.
 *
 * **Colour.** Nothing here names a hex value. `contrast` is the sheet and
 * `textOnContrast` is the type, so the design renders as a coherent poster in
 * every palette family — cobalt in Eski klassika, near-black in Limon va tun.
 * The `eski_klassika` family is the one the design was drawn for.
 *
 * **Cropping.** The brief asks for hero glyphs cropped by the canvas edge. The
 * renderer clamps content-bearing elements back inside the slide (layout.ts), so
 * a negative frame would simply be pushed back and the composition would drift.
 * The effect is built instead from frames that run to within a couple of percent
 * of the edge: the type still reads as bleeding off the sheet, and it survives
 * the repair pass unchanged.
 *
 * **Leading.** Display slots set `leading` explicitly — 0.82–0.90 — which is
 * what makes stacked capitals read as one block. Body copy keeps the engine's
 * default so it stays readable.
 *
 * **Overlap.** Script hangs over the capitals by a tenth of its own band. That
 * is the 8–15% the design asks for once the face's side bearings are taken off,
 * and it stays under the collision threshold the render tests enforce.
 *
 * Fifteen compositions are mapped onto the twelve `LayoutName`s the pipeline
 * addresses, so the busiest names carry several variants that the engine rotates
 * by slide position. That rotation is also what produces the loud → quiet →
 * loud rhythm the design depends on.
 */ /* ------------------------------------------------------------------ ground -- */ /**
 * The printed sheet. A flat fill would read as a screen, so the ground carries a
 * vertical lift and, on the louder slides, two faint misregistration bands —
 * the trace a screen-print leaves. Everything here sits at 10–50% opacity and
 * none of it ever crosses a headline.
 */ function press(weather = "full") {
  return [
    bleed("contrast"),
    shape([
      0,
      0,
      1000,
      296
    ], "surfaceAlt", {
      round: 0,
      opacity: 0.5,
      z: 0
    }),
    shape([
      0,
      388,
      1000,
      174.5
    ], "primary", {
      round: 0,
      opacity: 0.32,
      z: 0
    }),
    ...weather === "full" ? [
      shape([
        -60,
        126,
        1120,
        3
      ], "secondary", {
        round: 0,
        opacity: 0.14,
        z: 1
      }),
      shape([
        -60,
        434,
        1120,
        2
      ], "secondary", {
        round: 0,
        opacity: 0.1,
        z: 1
      })
    ] : []
  ];
}
/* ------------------------------------------------------------------ chrome -- */ /** The publication line. Information slides carry it; poster slides never do. */ function chrome() {
  return [
    txt("sectionLabel", [
      58,
      38,
      420,
      18
    ], "micro", "textSecondary", {
      family: "body",
      transform: "upper",
      letterSpacing: 1.6,
      fit: {
        maxLines: 1,
        minFont: 12
      },
      z: 8
    }),
    txt("pageNumber", [
      640,
      38,
      302,
      18
    ], "micro", "textSecondary", {
      family: "body",
      align: "right",
      transform: "upper",
      letterSpacing: 1.6,
      fit: {
        maxLines: 1,
        minFont: 12
      },
      z: 8
    })
  ];
}
/** The one decorative mark the system allows: a short lime rule. */ function limeRule(x: number, y: number, width = 72) {
  return shape([
    x,
    y,
    width,
    3
  ], "accent", {
    round: 0,
    z: 6
  });
}
/**
 * A block of condensed capitals. `leading` near its own height is the point: two
 * lines of this must look like one mass of ink, not like a paragraph.
 */ function display(band: Band) {
  const { x, y, width, height, align = "left", role = "title", font = "mega", maxLines = 2, minFont = 44, z = 5 } = band;
  return txt(role, [
    x,
    y,
    width,
    height
  ], font, "textOnContrast", {
    family: "display",
    weight: 700,
    align,
    transform: "upper",
    letterSpacing: -2,
    leading: 0.84,
    fit: {
      maxLines,
      minFont
    },
    z
  });
}
/**
 * The script phrase. Always one line, always white, always drawn above the
 * capitals in z-order so the hand reads as written over the poster.
 */ function script(band: Band) {
  const { x, y, width, height, align = "left", role = "subtitle", font = "display", minFont = 28, z = 7 } = band;
  return txt(role, [
    x,
    y,
    width,
    height
  ], font, "textOnContrast", {
    family: "script",
    align,
    leading: 0.95,
    fit: {
      maxLines: 1,
      minFont
    },
    z
  });
}
/** Reading copy. Never competes: no caps, no tracking, no display weight. */ function copy(band: Band) {
  const { x, y, width, height, align = "left", role = "body", font = "caption", maxLines = 6, minFont = 12, z = 6 } = band;
  return txt(role, [
    x,
    y,
    width,
    height
  ], font, "textSecondary", {
    family: "body",
    align,
    leading: 1.42,
    fit: role === "bullets" ? {
      maxItems: maxLines,
      maxChars: 110,
      minFont
    } : {
      maxLines,
      minFont
    },
    z
  });
}
/* ------------------------------------------------------ the fifteen masters -- */ /** 01 — WELCOME HERO. Script phrase, then the largest capitals in the deck. */ const welcomeHero = {
  slots: [
    ...press("full"),
    display({
      x: 26,
      y: 182,
      width: 948,
      height: 268,
      maxLines: 2,
      minFont: 54
    }),
    script({
      x: 30,
      y: 92,
      width: 600,
      height: 100,
      minFont: 30
    }),
    limeRule(30, 452, 96),
    txt("brand", [
      30,
      470,
      520,
      22
    ], "caption", "textSecondary", {
      family: "body",
      transform: "upper",
      letterSpacing: 1.8,
      fit: {
        maxLines: 1,
        minFont: 12
      },
      z: 6
    }),
    txt("pageNumber", [
      700,
      470,
      270,
      22
    ], "caption", "textSecondary", {
      family: "body",
      align: "right",
      transform: "upper",
      letterSpacing: 1.8,
      fit: {
        maxLines: 1,
        minFont: 12
      },
      z: 6
    })
  ]
};
/**
 * 02 — REPEATED ANNOUNCEMENT. One word laid four times across the sheet, the
 * third row solid and the rest ghosted back into the ground. Rows sit edge to
 * edge with no gap, which is what makes the sheet read as printed rather than
 * laid out. A quiet line at the foot keeps the slide's own copy from vanishing.
 */ const repeatedLadder = {
  slots: [
    ...press("full"),
    txt("title", [
      12,
      20,
      976,
      104
    ], "display", "secondary", {
      family: "display",
      weight: 700,
      transform: "upper",
      letterSpacing: -1.4,
      leading: 0.84,
      fit: {
        maxLines: 1,
        minFont: 30
      },
      z: 4
    }),
    txt("title", [
      12,
      124,
      976,
      104
    ], "display", "border", {
      family: "display",
      weight: 700,
      transform: "upper",
      letterSpacing: -1.4,
      leading: 0.84,
      fit: {
        maxLines: 1,
        minFont: 30
      },
      z: 4
    }),
    txt("title", [
      12,
      228,
      976,
      104
    ], "display", "textOnContrast", {
      family: "display",
      weight: 700,
      transform: "upper",
      letterSpacing: -1.4,
      leading: 0.84,
      fit: {
        maxLines: 1,
        minFont: 30
      },
      z: 5
    }),
    txt("title", [
      12,
      332,
      976,
      104
    ], "display", "secondary", {
      family: "display",
      weight: 700,
      transform: "upper",
      letterSpacing: -1.4,
      leading: 0.84,
      fit: {
        maxLines: 1,
        minFont: 30
      },
      z: 4
    }),
    copy({
      x: 58,
      y: 458,
      width: 560,
      height: 82,
      role: "bullets",
      maxLines: 3
    })
  ]
};
/** 03 — GIANT ANNOUNCEMENT + SMALL CTA. Extreme scale contrast, nothing else. */ const giantWithCta = {
  slots: [
    ...press("full"),
    display({
      x: 26,
      y: 44,
      width: 700,
      height: 400,
      maxLines: 4,
      minFont: 48
    }),
    limeRule(760, 268, 56),
    copy({
      x: 760,
      y: 286,
      width: 208,
      height: 200,
      role: "bullets",
      maxLines: 4
    })
  ]
};
/** 04 — COMING UP HERO. The headline takes the sheet; one quiet line follows. */ const comingUpHero = {
  slots: [
    ...press("full"),
    display({
      x: 26,
      y: 34,
      width: 948,
      height: 396,
      maxLines: 3,
      minFont: 56
    }),
    copy({
      x: 58,
      y: 452,
      width: 620,
      height: 76,
      role: "bullets",
      maxLines: 2
    })
  ]
};
/** 05 — SCRIPT SANDWICH, quote voice. Capitals, script, capitals. */ const sandwichQuote = {
  slots: [
    ...press("full"),
    display({
      x: 548,
      y: 18,
      width: 428,
      height: 92,
      font: "title",
      maxLines: 2,
      minFont: 22
    }),
    script({
      x: 130,
      y: 100,
      width: 740,
      height: 200,
      role: "quoteText",
      align: "center",
      minFont: 30
    }),
    display({
      x: 270,
      y: 330,
      width: 460,
      height: 76,
      role: "quoteAttribution",
      font: "title",
      maxLines: 2,
      minFont: 20,
      z: 5
    })
  ]
};
/** 05b — SCRIPT SANDWICH, theme voice. The same three-decker carrying copy. */ const sandwichTheme = {
  slots: [
    ...press("full"),
    display({
      x: 548,
      y: 18,
      width: 428,
      height: 92,
      font: "title",
      maxLines: 2,
      minFont: 22
    }),
    script({
      x: 130,
      y: 100,
      width: 740,
      height: 190,
      align: "center",
      minFont: 28
    }),
    copy({
      x: 200,
      y: 322,
      width: 600,
      height: 180,
      role: "bullets",
      align: "center",
      maxLines: 4
    })
  ]
};
/**
 * 06 — TOP-LEFT INFORMATION. The right three-fifths stay empty on purpose. A
 * user-supplied photograph is the one thing allowed to fill them, and only
 * because the alternative is dropping an image the author chose to upload.
 */ const topLeftInfo = {
  slots: [
    ...press("quiet"),
    ...chrome(),
    display({
      x: 58,
      y: 78,
      width: 340,
      height: 116,
      font: "title",
      maxLines: 2,
      minFont: 24
    }),
    limeRule(58, 196),
    copy({
      x: 58,
      y: 210,
      width: 330,
      height: 250,
      role: "bullets",
      maxLines: 6
    }),
    // The one photograph this system allows: square-cornered, hard-edged, and
    // dropped straight onto the ground with no card behind it.
    {
      kind: "image",
      role: "image",
      when: "hasImage",
      frame: [560, 96, 396, 370],
      radius: 0,
      z: 3,
    } as Slot
  ]
};
/** 07 — CENTERED QUOTE. Optically centred, with a small capitals label under it. */ const centeredQuote = {
  slots: [
    ...press("quiet"),
    ...chrome(),
    txt("quoteText", [
      190,
      168,
      620,
      168
    ], "heading", "textOnContrast", {
      family: "body",
      align: "center",
      leading: 1.42,
      fit: {
        maxLines: 6,
        minFont: 15
      },
      z: 6
    }),
    limeRule(470, 366, 60),
    display({
      x: 250,
      y: 392,
      width: 500,
      height: 44,
      role: "quoteAttribution",
      font: "heading",
      align: "center",
      maxLines: 1,
      minFont: 16,
      z: 6
    })
  ]
};
/**
 * 08 — THREE-COLUMN INFORMATION. Numbered, aligned on one baseline, separated by
 * air alone: no rules, no cards. Columns two and three appear only when the
 * slide actually has copy for them, so a thin slide reads as one column and not
 * as two empty ones.
 */ const threeColumn = {
  slots: [
    ...press("quiet"),
    ...chrome(),
    display({
      x: 58,
      y: 62,
      width: 620,
      height: 74,
      font: "title",
      maxLines: 2,
      minFont: 22
    }),
    txt("sectionLabel", [
      58,
      150,
      270,
      52
    ], "title", "accent", {
      family: "display",
      weight: 700,
      literal: "01",
      leading: 0.9,
      fit: {
        maxLines: 1,
        minFont: 20
      },
      z: 6
    }),
    txt("sectionLabel", [
      383,
      150,
      270,
      52
    ], "title", "accent", {
      family: "display",
      weight: 700,
      literal: "02",
      leading: 0.9,
      when: "hasBody",
      fit: {
        maxLines: 1,
        minFont: 20
      },
      z: 6
    }),
    txt("sectionLabel", [
      708,
      150,
      270,
      52
    ], "title", "accent", {
      family: "display",
      weight: 700,
      literal: "03",
      leading: 0.9,
      when: "hasSubtitle",
      fit: {
        maxLines: 1,
        minFont: 20
      },
      z: 6
    }),
    copy({
      x: 58,
      y: 216,
      width: 270,
      height: 250,
      role: "bullets",
      maxLines: 3
    }),
    copy({
      x: 383,
      y: 216,
      width: 270,
      height: 250,
      maxLines: 9
    }),
    copy({
      x: 708,
      y: 216,
      width: 270,
      height: 250,
      role: "subtitle",
      maxLines: 9
    })
  ]
};
/** 09 — SUPPORT CALL. Script across the top, a tight stack of capitals under it. */ const supportCall = {
  slots: [
    ...press("full"),
    script({
      x: 26,
      y: 34,
      width: 800,
      height: 128,
      minFont: 34
    }),
    display({
      x: 44,
      y: 149,
      width: 800,
      height: 240,
      maxLines: 4,
      minFont: 40
    }),
    limeRule(44, 396),
    copy({
      x: 44,
      y: 410,
      width: 620,
      height: 118,
      role: "bullets",
      maxLines: 3
    })
  ]
};
/** 10 — EMOTIONAL PAUSE. One script phrase on an empty sheet. The deck breathes. */ const scriptPause = {
  slots: [
    ...press("quiet"),
    script({
      x: 200,
      y: 170,
      width: 600,
      height: 200,
      role: "quoteText",
      align: "center",
      minFont: 30
    })
  ]
};
/** 11 — SCRIPT + FIGURE. Script label over the figure, both optically centred. */ const scriptFigure = {
  slots: [
    ...press("quiet"),
    display({
      x: 270,
      y: 56,
      width: 460,
      height: 54,
      font: "heading",
      align: "center",
      maxLines: 2,
      minFont: 14,
      z: 6
    }),
    script({
      x: 270,
      y: 130,
      width: 460,
      height: 120,
      role: "statLabel",
      align: "center",
      minFont: 30
    }),
    display({
      x: 230,
      y: 238,
      width: 540,
      height: 190,
      role: "statValue",
      align: "center",
      maxLines: 1,
      minFont: 60
    }),
    copy({
      x: 230,
      y: 448,
      width: 540,
      height: 76,
      align: "center",
      maxLines: 3
    })
  ]
};
/** 12 — SMALL CENTRAL CALL. Deliberately small, with the sheet left empty around it. */ const smallCentralCall = {
  slots: [
    ...press("quiet"),
    display({
      x: 380,
      y: 200,
      width: 240,
      height: 56,
      font: "heading",
      align: "center",
      maxLines: 2,
      minFont: 16
    }),
    script({
      x: 330,
      y: 251,
      width: 340,
      height: 110,
      align: "center",
      minFont: 28
    }),
    copy({
      x: 330,
      y: 388,
      width: 340,
      height: 88,
      role: "bullets",
      align: "center",
      maxLines: 2
    })
  ]
};
/** 13 — LOWER-LEFT QUESTION. The top and right of the sheet stay empty. */ const lowerLeftQuestion = {
  slots: [
    ...press("quiet"),
    display({
      x: 54,
      y: 286,
      width: 430,
      height: 150,
      font: "display",
      maxLines: 2,
      minFont: 34,
      z: 5
    }),
    copy({
      x: 54,
      y: 448,
      width: 400,
      height: 62,
      maxLines: 3
    }),
    txt("brand", [
      54,
      518,
      400,
      18
    ], "micro", "textSecondary", {
      family: "body",
      transform: "upper",
      letterSpacing: 2,
      fit: {
        maxLines: 1,
        minFont: 12
      },
      z: 6
    })
  ]
};
/** 14 — HEAVY LEFT. Script over capitals on the left, one light column right. */ const heavyLeft = {
  slots: [
    ...press("full"),
    script({
      x: 20,
      y: 74,
      width: 520,
      height: 118,
      minFont: 30
    }),
    display({
      x: 16,
      y: 180,
      width: 600,
      height: 190,
      maxLines: 2,
      minFont: 52
    }),
    limeRule(660, 122, 56),
    copy({
      x: 660,
      y: 140,
      width: 300,
      height: 200,
      role: "bullets",
      maxLines: 4
    }),
    copy({
      x: 16,
      y: 404,
      width: 560,
      height: 106,
      maxLines: 4
    })
  ]
};
/** 15 — END CARD. Script phrase, then the closing word set as large as it fits. */ const finalEndCard = {
  slots: [
    ...press("full"),
    display({
      x: 180,
      y: 244,
      width: 640,
      height: 210,
      align: "center",
      maxLines: 1,
      minFont: 64
    }),
    script({
      x: 230,
      y: 150,
      width: 540,
      height: 104,
      align: "center",
      minFont: 30
    }),
    txt("brand", [
      280,
      478,
      440,
      22
    ], "caption", "textSecondary", {
      family: "body",
      align: "center",
      transform: "upper",
      letterSpacing: 2.4,
      fit: {
        maxLines: 1,
        minFont: 12
      },
      z: 6
    })
  ]
};
/* --------------------------------------------------- utilitarian layouts -- */ /**
 * The agenda is always slide two, so it never gets a variant — it gets the one
 * composition that can hold ten section titles: a full-width ladder of capitals
 * under the headline, which is master 02's typographic ritual applied to a list.
 */ const agendaLadder = {
  slots: [
    ...press("quiet"),
    ...chrome(),
    display({
      x: 58,
      y: 62,
      width: 620,
      height: 78,
      font: "title",
      maxLines: 1,
      minFont: 24
    }),
    limeRule(58, 152, 80),
    txt("bullets", [
      58,
      172,
      880,
      344
    ], "heading", "textOnContrast", {
      family: "display",
      weight: 700,
      transform: "upper",
      letterSpacing: -0.4,
      leading: 1.06,
      fit: {
        maxItems: 8,
        maxChars: 110,
        minFont: 14
      },
      z: 6
    })
  ]
};
/** A statistic is master 03's scale contrast with the figure in the giant slot. */ const statFigure = {
  slots: [
    ...press("full"),
    txt("title", [
      30,
      38,
      620,
      38
    ], "caption", "textSecondary", {
      family: "body",
      transform: "upper",
      letterSpacing: 1.6,
      fit: {
        maxLines: 1,
        minFont: 12
      },
      z: 6
    }),
    display({
      x: 26,
      y: 84,
      width: 640,
      height: 300,
      role: "statValue",
      maxLines: 1,
      minFont: 60
    }),
    limeRule(720, 232, 56),
    copy({
      x: 720,
      y: 250,
      width: 250,
      height: 160,
      role: "statLabel",
      maxLines: 6
    }),
    copy({
      x: 26,
      y: 410,
      width: 620,
      height: 100,
      maxLines: 4
    })
  ]
};
/** A chart keeps the sheet and takes lime as its series colour — no panel, no card. */ const chartSlide = {
  slots: [
    ...press("quiet"),
    ...chrome(),
    display({
      x: 58,
      y: 62,
      width: 380,
      height: 96,
      font: "title",
      maxLines: 2,
      minFont: 22
    }),
    copy({
      x: 58,
      y: 180,
      width: 340,
      height: 280,
      maxLines: 10
    }),
    chart([
      450,
      96,
      500,
      370
    ], "bar", "accent", {
      trackColor: "border",
      labelColor: "textOnContrast",
      z: 6
    })
  ]
};
/** References: quiet, left, generous. Nothing decorative competes with a URL. */ const referencesList = {
  slots: [
    ...press("quiet"),
    ...chrome(),
    display({
      x: 58,
      y: 96,
      width: 620,
      height: 70,
      font: "title",
      maxLines: 1,
      minFont: 24
    }),
    limeRule(58, 174),
    copy({
      x: 58,
      y: 190,
      width: 880,
      height: 316,
      role: "sources",
      maxLines: 10
    })
  ]
};
/* ------------------------------------------------------------- the export -- */ export const eskiKlassika: SlideTemplate = {
  code: "eski_klassika",
  name: "Eski klassika",
  style: "super_professional",
  tagline: "Qirol ko‘ki, ulkan kondensdik bosh harflar va oq qo‘lyozma urg‘u",
  sortOrder: 3,
  artDirection: {
    imageStyle: "Not used. The design is typographic: a slide's graphic is its own headline. " + "If the author supplies a photograph it is placed as a plain rectangular crop, never framed or tilted.",
    illustrationStyle: "None. Decoration is limited to a short lime rule and a set ordinal.",
    mood: "Retro editorial poster. Confident, quiet, printed rather than rendered.",
    decorativeElements: [
      "short lime rule",
      "set ordinals",
      "ghosted repeated capitals",
      "faint press texture"
    ],
    chartStyle: "Flat lime bars straight on the cobalt sheet. No panel, no gridlines, no shadows.",
    spacingStyle: "Edge-to-edge display type against large deliberate emptiness; loud and quiet slides alternate.",
    typography: {
      // The licensed faces the design was drawn with. `blueprint.fonts` names the
      // bundled stand-ins that actually render; swap those when the files ship.
      display: "Bebas Neue Bold — very large condensed capitals, tracking -1% to -3%, leading 0.78–0.90",
      body: "Helvetica Now Display / Arial-metric grotesque, regular, modest size, never competing"
    },
    imagePolicy: "none"
  },
  blueprint: {
    // The largest mega step in the product. Master 04 is meant to fill the sheet,
    // and `fitText` only ever shrinks from here — so the ceiling has to be high.
    type: {
      mega: 128,
      display: 80,
      title: 48,
      heading: 30,
      body: 19,
      caption: 14,
      micro: 11
    },
    // No cards, no rounded panels: the sheet is the only surface.
    radius: {
      card: 0,
      image: 0
    },
    fonts: {
      // Lavonia Classy and Bebas Neue Bold are the brief's faces. Bebas ships with
      // the app; Lavonia is licensed and not bundled, so Parisienne — the closest
      // elegant retro script in the app's font set — stands in until it is.
      script: "Parisienne_400Regular",
      display: "BebasNeue_400Regular",
      body: "Arimo_400Regular"
    },
    fallback: topLeftInfo,
    layouts: {
      cover: welcomeHero,
      agenda: agendaLadder,
      // Loud, then quiet, then loud again: the variant the engine picks is the
      // slide's position, so consecutive slides never repeat a composition.
      title_body: [
        topLeftInfo,
        giantWithCta,
        lowerLeftQuestion
      ],
      two_columns: [
        threeColumn,
        heavyLeft,
        topLeftInfo
      ],
      comparison: [
        threeColumn,
        repeatedLadder,
        sandwichTheme
      ],
      timeline: [
        threeColumn,
        repeatedLadder
      ],
      statistic: [
        statFigure,
        scriptFigure
      ],
      quote: [
        centeredQuote,
        scriptPause,
        sandwichQuote
      ],
      chart: chartSlide,
      conclusion: [
        supportCall,
        comingUpHero,
        smallCentralCall
      ],
      references: referencesList,
      thanks: finalEndCard
    }
  },
  previewLayout: "cover"
};
