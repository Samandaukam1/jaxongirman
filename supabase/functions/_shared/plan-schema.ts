const nullableString = {
  type: [
    "string",
    "null"
  ]
};
/**
 * The cover, agenda, bibliography and closing slides are assembled from data the
 * server already holds, so the model only ever plans the slides in between and
 * can never spend one of them on a layout the deck structure owns.
 */ const CONTENT_LAYOUTS = [
  "title_body",
  "two_columns",
  "statistic",
  "quote",
  "comparison",
  "timeline",
  "chart",
  "table",
  "conclusion"
];
/**
 * A table the writer found in its research.
 *
 * Bounded small on purpose: a slide is not a spreadsheet, and a design's table
 * archetype is drawn for a handful of rows. Anything larger belongs in a
 * document, and the renderer would shrink it past readability trying.
 */ const tableSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        columns: {
          type: "array",
          items: {
            type: "string"
          },
          minItems: 2,
          maxItems: 6
        },
        /**
         * A row is an object holding its cells, not an array of arrays.
         *
         * The nested form is the natural way to write a table and the one
         * Gemini handles worst: asked for nothing but an array whose items are
         * arrays, it took longer than fifteen seconds to answer a three-cell
         * example, and the slide-copy request carrying it was refused outright
         * while the outline request — identical but for this — went through
         * every time.
         *
         * Wrapping each row costs one key and is undone the moment the answer
         * is parsed, so nothing downstream ever sees this shape.
         */
        rows: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              cells: {
                type: "array",
                items: { type: "string" },
                minItems: 2,
                maxItems: 6
              }
            },
            required: ["cells"]
          },
          minItems: 2,
          maxItems: 8
        }
      },
      required: [
        "columns",
        "rows"
      ]
    },
    {
      type: "null"
    }
  ]
};
export function outlineSchema(slideCount: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      // Colour, typography and decoration come from the user's chosen template
      // and palette family, so the model is only asked for narrative direction.
      visualDna: {
        type: "object",
        additionalProperties: false,
        properties: {
          mood: {
            type: "string"
          },
          era: {
            type: "string"
          },
          visualStyle: {
            type: "string"
          },
          textures: {
            type: "array",
            items: {
              type: "string"
            },
            maxItems: 5
          },
          imageDirection: {
            type: "string"
          }
        },
        required: [
          "mood",
          "era",
          "visualStyle",
          "textures",
          "imageDirection"
        ]
      },
      slides: {
        type: "array",
        minItems: slideCount,
        maxItems: slideCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: {
              type: "string"
            },
            purpose: {
              type: "string"
            },
            layout: {
              type: "string",
              enum: CONTENT_LAYOUTS
            },
            visualPrompt: nullableString
          },
          required: [
            "title",
            "purpose",
            "layout",
            "visualPrompt"
          ]
        }
      }
    },
    required: [
      "visualDna",
      "slides"
    ]
  };
}
const quoteSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string"
        },
        attribution: {
          type: "string"
        }
      },
      required: [
        "text",
        "attribution"
      ]
    },
    {
      type: "null"
    }
  ]
};
const statisticSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        value: {
          type: "string"
        },
        label: {
          type: "string"
        }
      },
      required: [
        "value",
        "label"
      ]
    },
    {
      type: "null"
    }
  ]
};
const chartObjectSchema = (visualStatisticOnly = false) => ({
      type: "object",
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: visualStatisticOnly ? ["bar", "donut"] : ["bar", "line", "donut"]
        },
        labels: {
          type: "array",
          items: {
            type: "string"
          },
          minItems: 2,
          maxItems: 8
        },
        values: {
          type: "array",
          items: {
            type: "number"
          },
          minItems: 2,
          maxItems: 8
        }
      },
      required: [
        "type",
        "labels",
        "values"
      ]
    });
const chartSchema = {
  anyOf: [
    chartObjectSchema(),
    {
      type: "null"
    }
  ]
};
/**
 * One slide, and never more than one.
 *
 * The deck used to be written in a single request whose schema grew with it:
 * six slides meant six copies of this object nested inside an array, ten meant
 * ten. Gemini accepted one and refused six with INVALID_ARGUMENT, naming
 * nothing — and the refusal scaled with the count rather than with any keyword
 * in it, which is the shape of a size limit rather than a vocabulary problem.
 *
 * So the number of slides changes the number of requests, and this stays the
 * same size forever. It is also the unit everything else already works in:
 * a slot budget is per slide, a fit check is per slide, and a rewrite was
 * always about one slide that did not fit.
 */
export type RequiredSlideContent = "body" | "bullets" | "subtitle" | "quote" | "statistic";

/**
 * A generic semantic slide has more fields than most designs can draw.
 *
 * The selected archetype is already known before writing, so make the one
 * content family that page actually exposes non-null in the response schema.
 * Prompting alone was not enough: the model occasionally returned both
 * `body: null` and `bullets: []` for a body-only page, leaving a perfectly good
 * composition with nothing but its heading.
 */
export function slideSchema(options: {
  requireVisualStatistic?: boolean;
  requiredContent?: RequiredSlideContent;
} = {}): Record<string, unknown> {
  const required = options.requiredContent;
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      subtitle: required === "subtitle" ? { type: "string" } : nullableString,
      bullets: {
        type: "array",
        items: { type: "string" },
        ...(required === "bullets" ? { minItems: 1 } : {}),
        maxItems: 6,
      },
      body: required === "body" ? { type: "string" } : nullableString,
      quote: required === "quote" ? quoteSchema.anyOf[0] : quoteSchema,
      statistic: required === "statistic" ? statisticSchema.anyOf[0] : statisticSchema,
      // The one chart slide is non-null by schema, not by hope. Restricting it
      // to bar/donut also makes the user's "pie or bar" requirement exact;
      // line charts remain available on any additional, optional chart slide.
      chart: options.requireVisualStatistic ? chartObjectSchema(true) : chartSchema,
      table: tableSchema,
    },
    required: ["title", "subtitle", "bullets", "body", "quote", "statistic", "chart", "table"],
  };
}

/**
 * Every slide at once.
 *
 * Kept because the mock path and the tests read it, and because it documents
 * the shape a deck assembles into. Nothing on the generation path sends it any
 * more — see `slideSchema`.
 */
export function contentSchema(slideCount: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      slides: {
        type: "array",
        minItems: slideCount,
        maxItems: slideCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: {
              type: "string"
            },
            subtitle: nullableString,
            bullets: {
              type: "array",
              items: {
                type: "string"
              },
              maxItems: 6
            },
            body: nullableString,
            quote: quoteSchema,
            statistic: statisticSchema,
            chart: chartSchema,
            table: tableSchema
          },
          required: [
            "title",
            "subtitle",
            "bullets",
            "body",
            "quote",
            "statistic",
            "chart",
            "table"
          ]
        }
      }
    },
    required: [
      "slides"
    ]
  };
}
export const editorOperationsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operations: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          elementId: {
            type: "string"
          },
          x: {
            type: [
              "number",
              "null"
            ]
          },
          y: {
            type: [
              "number",
              "null"
            ]
          },
          width: {
            type: [
              "number",
              "null"
            ]
          },
          height: {
            type: [
              "number",
              "null"
            ]
          },
          rotation: {
            type: [
              "number",
              "null"
            ]
          },
          zIndex: {
            type: [
              "integer",
              "null"
            ]
          },
          opacity: {
            type: [
              "number",
              "null"
            ]
          },
          text: nullableString,
          fill: nullableString,
          color: nullableString,
          fontSize: {
            type: [
              "number",
              "null"
            ]
          }
        },
        required: [
          "elementId",
          "x",
          "y",
          "width",
          "height",
          "rotation",
          "zIndex",
          "opacity",
          "text",
          "fill",
          "color",
          "fontSize"
        ]
      }
    },
    explanation: {
      type: "string"
    }
  },
  required: [
    "operations",
    "explanation"
  ]
};

/**
 * What comes back when copy is asked to be shorter.
 *
 * Only the fields that did not fit, and only their text. Nothing about type
 * size: shrinking is the renderer's last resort and is not the writer's to
 * offer, which is the whole point of asking for a rewrite instead.
 */ export function rewriteSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      slides: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            slide: { type: "integer" },
            fields: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  field: { type: "string" },
                  text: { type: "string" }
                },
                required: ["field", "text"]
              }
            }
          },
          required: ["slide", "fields"]
        }
      }
    },
    required: ["slides"]
  };
}
