/**
 * What a template's page can be for.
 *
 * One list, because two screens ask the same question — the import screen when
 * a template arrives and the editor when somebody disagrees with the answer —
 * and the values are a database enum. A second copy would drift from the enum
 * on the first day somebody added a role to one of them.
 */

export const ROLE_GROUPS: { label: string; roles: string[] }[] = [
  {
    label: "Hikoya",
    roles: [
      "welcome", "introduction", "overview", "key_concepts", "importance",
      "types", "structure", "process", "methods", "analysis", "challenges",
      "solutions", "applications", "examples", "results", "recommendations",
      "conclusion", "thanks",
    ],
  },
  {
    label: "Ko‘rinish",
    roles: [
      "agenda", "timeline", "comparison", "big_number", "quote", "case_study",
      "data", "chart", "table", "image_story", "references",
    ],
  },
];

export const ROLE_LABELS: Record<string, string> = {
  welcome: "Ochilish", introduction: "Kirish", overview: "Umumiy ko‘rinish",
  key_concepts: "Asosiy tushunchalar", importance: "Ahamiyati", types: "Turlari",
  structure: "Tuzilishi", process: "Jarayon", methods: "Usullar", analysis: "Tahlil",
  challenges: "Muammolar", solutions: "Yechimlar", applications: "Qo‘llanilishi",
  examples: "Misollar", results: "Natijalar", recommendations: "Tavsiyalar",
  conclusion: "Xulosa", thanks: "Yakun", agenda: "Reja", timeline: "Vaqt chizig‘i",
  comparison: "Taqqoslash", big_number: "Katta raqam", quote: "Iqtibos",
  case_study: "Amaliy misol", data: "Ma’lumot", chart: "Diagramma", table: "Jadval",
  image_story: "Rasmli sahifa", references: "Manbalar",
};

/** Every role, so a stored value that is not in a group is still recognised. */
export const ALL_ROLES = ROLE_GROUPS.flatMap((group) => group.roles);
