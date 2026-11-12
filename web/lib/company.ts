/**
 * The organisation behind Jaxongirman, and its papers — one source.
 *
 * Jaxongirman is a project run by “MUKAMMAL MEDIA GROUP” MChJ, the company that
 * also runs liderlar.uz; every value here is copied from the two documents in
 * `public/legal/` (and matches liderlar.uz's `src/lib/legal/company.ts`). The
 * legal pages, the footer and the placeholders on the pages read from here, so
 * a requisite cannot read one way on one page and another way on the next.
 *
 * When a document is renewed, its PDF, its preview and this file change
 * together.
 */
export const LEGAL_ENTITY = {
  fullName: "“MUKAMMAL MEDIA GROUP” MAS’ULIYATI CHEKLANGAN JAMIYAT",
  shortName: "“MUKAMMAL MEDIA GROUP” MChJ",
  tin: "312 745 545",
  address: "Toshkent shahri, Yunusobod tumani, Firdavsiy MFY, Chingiz Aytmatov ko‘chasi, 50-uy",
  certificateNumber: "5938902",
  registeredOn: "25.01.2026",
  publishingNoticeNumber: "1761798",
} as const;

export type LegalDocument = {
  id: string;
  eyebrow: string;
  title: string;
  pdfHref: string;
  downloadName: string;
  previewSrc: string;
  previewWidth: number;
  previewHeight: number;
  facts: { label: string; value: string }[];
  verification: { text: string; status: string; href: string };
};

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    id: "guvohnoma",
    eyebrow: "Davlat ro‘yxatidan o‘tish",
    title: "Yuridik shaxsni davlat ro‘yxatidan o‘tkazilganligi to‘g‘risidagi guvohnoma",
    pdfHref: "/legal/mukammal-media-group-guvohnoma.pdf",
    downloadName: "Mukammal-Media-Group-MCHJ-guvohnoma.pdf",
    previewSrc: "/legal/mukammal-media-group-guvohnoma.webp",
    previewWidth: 1000,
    previewHeight: 1416,
    facts: [
      { label: "To‘liq nomi", value: LEGAL_ENTITY.fullName },
      { label: "STIR", value: LEGAL_ENTITY.tin },
      { label: "Hujjat raqami", value: LEGAL_ENTITY.certificateNumber },
      { label: "Berilgan sana", value: LEGAL_ENTITY.registeredOn },
      { label: "Tasdiqlash raqami", value: "3101815" },
      { label: "Tomonidan berilgan", value: "Toshkent shahri, Yunusobod tumani DXM" },
      { label: "Faoliyat manzili", value: LEGAL_ENTITY.address },
    ],
    // Read from the Ministry of Justice page the document's QR opens.
    verification: {
      text: "Adliya vazirligining tadbirkorlik subyektlarini ro‘yxatdan o‘tkazish tizimida 2026-yil 6-noyabr holatiga ko‘ra tadbirkorlik holati:",
      status: "Faoliyat ko‘rsatayotgan hamda soliq majburiyatlariga ega",
      href: "https://new.birdarcha.uz/document/d7055d01-623d-4eab-bf86-cdd35a046ef3",
    },
  },
  {
    id: "tasdiqnoma",
    eyebrow: "Noshirlik faoliyati",
    title: "Xabarnoma qabul qilinganligi to‘g‘risida tasdiqnoma",
    pdfHref: "/legal/mukammal-media-group-noshirlik-tasdiqnoma.pdf",
    downloadName: "Mukammal-Media-Group-MCHJ-noshirlik-tasdiqnoma.pdf",
    previewSrc: "/legal/mukammal-media-group-noshirlik-tasdiqnoma.webp",
    previewWidth: 1000,
    previewHeight: 1564,
    facts: [
      { label: "Tashkilot", value: LEGAL_ENTITY.fullName },
      { label: "Tasdiqnoma raqami", value: `№ ${LEGAL_ENTITY.publishingNoticeNumber}` },
      { label: "Reyestr tartib raqami", value: "X-25942660614" },
      { label: "STIR", value: LEGAL_ENTITY.tin },
      { label: "Taqdim etilgan sana", value: "06.08.2026, 14:49" },
      { label: "Xabarnoma", value: "Noshirlik faoliyatini boshlaganlik yoki tugatganlik haqida xabarnoma" },
      {
        label: "Vakolatli organ",
        value: "O‘zbekiston Respublikasi Raqamli texnologiyalar vazirligi huzuridagi Axborotlashtirish va telekommunikatsiyalar sohasida nazorat inspeksiyasi",
      },
    ],
    // The status is printed on the document; the registry finds it by STIR.
    verification: {
      text: "“Litsenziya” axborot tizimi reyestrida STIR bo‘yicha izlash mumkin. Hujjatda ko‘rsatilgan holat:",
      status: "Faol",
      href: "https://license.gov.uz/registry/b9b88cc1-f5eb-4e63-86a9-f6586a00ff47",
    },
  },
];
