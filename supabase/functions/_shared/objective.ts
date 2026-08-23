/**
 * The obyektivka, built to the document people are actually asked for.
 *
 * This is not a form somebody designed here. It is a specific document — the
 * one an Uzbek institution hands you with the fields already named — and its
 * shape is not ours to improve: the heading is centred and capitalised, the
 * photograph sits top right beside the date and the institution, the biography
 * fields run in labelled pairs down the page, work history follows under its
 * own centred heading, and the relatives table starts on a second page with its
 * own title naming the person again.
 *
 * Every one of those is copied from the sample rather than invented, because a
 * document that is nearly the expected one is refused at the desk exactly like
 * a document that is nothing like it.
 *
 * Pure: fields in, blocks out. What renders them is `docx.ts`, and the same
 * blocks describe the preview the phone draws, so what somebody sees while
 * typing and what comes out of the printer cannot disagree.
 */

import { cmToTwips, image, paragraph, table, type Block, type Cell } from "./docx.ts";

/** One labelled field of the biography, by the id the form binds to. */
export type FieldId =
  | "issued_on" | "institution"
  | "birth_date" | "birth_place"
  | "nationality" | "party"
  | "education" | "graduated"
  | "speciality"
  | "academic_degree" | "academic_title"
  | "languages" | "awards" | "elected_office";

export type WorkRow = { period: string; detail: string };

export type RelativeRow = {
  relation: string;
  name: string;
  born: string;
  work: string;
  address: string;
};

export type Objective = {
  fullName: string;
  fields: Partial<Record<FieldId, string>>;
  work: WorkRow[];
  relatives: RelativeRow[];
  /** Index into the images given to `buildDocx`, when a photograph was chosen. */
  photoIndex?: number;
};

/**
 * The label each field carries, and how it is laid out.
 *
 * `pair` fields share a line with the next one; `full` fields take the width.
 * Both the order and the wording come from the sample — "Qaysi chet tillarini
 * biladi" is not a phrasing anybody would choose today, and changing it would
 * make the document not the one being asked for.
 */
export const FIELDS: { id: FieldId; label: string; layout: "pair" | "full" }[] = [
  { id: "birth_date", label: "Tug‘ilgan yili:", layout: "pair" },
  { id: "birth_place", label: "Tug‘ilgan joyi:", layout: "pair" },
  { id: "nationality", label: "Millati:", layout: "pair" },
  { id: "party", label: "Partiyaviyligi:", layout: "pair" },
  { id: "education", label: "Ma’lumoti:", layout: "pair" },
  { id: "graduated", label: "Tamomlagan:", layout: "pair" },
  { id: "speciality", label: "Ma’lumoti bo‘yicha mutaxassisligi:", layout: "full" },
  { id: "academic_degree", label: "Ilmiy darajasi:", layout: "pair" },
  { id: "academic_title", label: "Ilmiy unvoni:", layout: "pair" },
  { id: "languages", label: "Qaysi chet tillarini biladi:", layout: "full" },
  { id: "awards", label: "Davlat mukofoti bilan taqdirlanganmi:", layout: "full" },
  {
    id: "elected_office",
    label: "Xalq deputatlari respublika, viloyat, shahar va tuman Kengashi deputatimi yoki boshqa saylanadigan organlarning a’zosimi:",
    layout: "full",
  },
];

export const RELATIVE_COLUMNS = [
  "Qarindoshligi",
  "Familyasi, ismi va otasining ismi",
  "Tug‘ilgan yili va joyi",
  "Ish joyi va lavozimi",
  "Turar joyi",
] as const;

/** An empty field prints as a dash, which is what the paper form does. */
const said = (value: string | undefined): string => (value ?? "").trim() || "-";

const labelled = (label: string, value: string | undefined): Block[] => [
  paragraph([{ text: label, bold: true }], { spaceAfter: 0 }),
  paragraph(said(value), { spaceAfter: 6 }),
];

/**
 * The whole document, as blocks.
 *
 * The text width is needed for the two tables that are laid out rather than
 * drawn — the header, which puts the photograph beside the date, and the field
 * pairs. Both are borderless: a table is how OOXML says "these sit side by
 * side", and the reader is not supposed to know one is there.
 */
export function objectiveBlocks(objective: Objective, options: { textWidthCm: number }): Block[] {
  const textWidth = cmToTwips(options.textWidthCm);
  const half = Math.floor(textWidth / 2);
  const blocks: Block[] = [];

  blocks.push(paragraph([{ text: "MA’LUMOTNOMA", bold: true }], { align: "center", spaceAfter: 6 }));
  blocks.push(paragraph([{ text: objective.fullName || "—", bold: true }], { align: "center", spaceAfter: 12 }));

  /**
   * The date, the institution and the photograph, on one line.
   *
   * A floating image anchored to a paragraph is the other way to do this and it
   * is the way that moves when somebody adds a line above it. A two-column
   * borderless table keeps the photograph where the form expects it however
   * much the left-hand column grows.
   */
  const headerLeft: Block[] = [
    paragraph(`${said(objective.fields.issued_on)} :`, { spaceAfter: 4 }),
    paragraph([{ text: said(objective.fields.institution), bold: true }], { spaceAfter: 0 }),
  ];
  const photoCell: Cell = {
    width: cmToTwips(3.6),
    blocks: objective.photoIndex === undefined
      ? [paragraph("")]
      : [image({ index: objective.photoIndex, widthCm: 3, heightCm: 4, align: "right" })],
  };
  blocks.push(table({
    borders: false,
    width: textWidth,
    rows: [{ cells: [{ width: textWidth - cmToTwips(3.6), blocks: headerLeft }, photoCell] }],
  }));

  blocks.push(paragraph("", { spaceAfter: 6 }));

  // The biography, in the order and the pairing the paper form uses.
  for (let index = 0; index < FIELDS.length; index += 1) {
    const field = FIELDS[index]!;
    if (field.layout === "full") {
      blocks.push(...labelled(field.label, objective.fields[field.id]));
      continue;
    }
    const next = FIELDS[index + 1];
    if (next && next.layout === "pair") {
      blocks.push(table({
        borders: false,
        width: textWidth,
        rows: [{
          cells: [
            { width: half, blocks: labelled(field.label, objective.fields[field.id]) },
            { width: half, blocks: labelled(next.label, objective.fields[next.id]) },
          ],
        }],
      }));
      index += 1;
      continue;
    }
    blocks.push(...labelled(field.label, objective.fields[field.id]));
  }

  blocks.push(paragraph([{ text: "MEHNAT FAOLIYATI", bold: true }], { align: "center", spaceAfter: 8 }));
  if (objective.work.length === 0) {
    blocks.push(paragraph("-"));
  } else {
    for (const row of objective.work) {
      blocks.push(paragraph(`${row.period.trim()} - ${row.detail.trim()}`.replace(/^ - /, ""), { spaceAfter: 4 }));
    }
  }

  /**
   * The relatives, on their own page.
   *
   * A page break rather than a gap: the sample is two pages and the second one
   * carries its own title naming the person again, because the pages are
   * routinely separated once they are filed.
   */
  blocks.push(paragraph(
    [{ text: `${objective.fullName || "—"} ning yaqin qarindoshlari haqida`, bold: true }],
    { align: "center", pageBreakBefore: true, spaceAfter: 0 },
  ));
  blocks.push(paragraph([{ text: "MA’LUMOT", bold: true }], { align: "center", spaceAfter: 10 }));

  const header = {
    header: true,
    cells: RELATIVE_COLUMNS.map((column) => ({
      blocks: [paragraph([{ text: column, bold: true, size: 12 }], { align: "center", spaceAfter: 0 })],
      align: "center" as const,
    })),
  };

  const body = (objective.relatives.length > 0 ? objective.relatives : [{
    relation: "", name: "", born: "", work: "", address: "",
  }]).map((row) => ({
    cells: [row.relation, row.name, row.born, row.work, row.address].map((value, column) => ({
      blocks: [paragraph([{ text: said(value), bold: column === 0, size: 12 }], { align: "center", spaceAfter: 0 })],
      align: "center" as const,
    })),
  }));

  blocks.push(table({ borders: true, width: textWidth, rows: [header, ...body] }));

  return blocks;
}

/** What is missing before this is worth handing in. */
export function missingFields(objective: Objective): string[] {
  const missing: string[] = [];
  if (!objective.fullName.trim()) missing.push("F.I.Sh.");
  for (const field of FIELDS) {
    if (field.layout === "pair" && !(objective.fields[field.id] ?? "").trim()) missing.push(field.label.replace(":", ""));
  }
  return missing;
}
