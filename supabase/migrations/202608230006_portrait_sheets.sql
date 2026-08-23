/**
 * Documents want a 3×4 photograph, and getting one costs an afternoon.
 *
 * The photo booth is across town, it is cash only, and it hands back nine
 * prints of a picture you cannot see until it is cut. Meanwhile everybody has a
 * camera and no way to turn what it takes into something an office accepts.
 *
 * So: a portrait becomes a print-ready A6 sheet — nine 30 × 40 mm photographs,
 * laid out to be cut apart, at a resolution a printer will not soften.
 *
 * The picture is made elsewhere. This app does not run an image model for it,
 * and the prompt below is why: the instruction is handed to the person, who
 * takes it wherever they already have a chat window open. That keeps the one
 * expensive part of the job off our bill and out of our failure modes.
 */

create table if not exists public.portrait_sheets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  /** The picture the person supplied, in `user-uploads`. */
  source_path text not null,
  /** The printable sheet, in `exports`. Null while it is being made. */
  sheet_path text,
  source_width integer,
  source_height integer,
  /** What was said about the crop, so the screen can repeat it later. */
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists portrait_sheets_owner_idx
  on public.portrait_sheets (owner_id, created_at desc);

alter table public.portrait_sheets enable row level security;

/**
 * A person reads and deletes their own; only the server writes one.
 *
 * No insert or update policy on purpose: the row records what was actually
 * rendered, and a client that could write it could claim a sheet exists that
 * nobody made.
 */
drop policy if exists portrait_sheets_owner_select on public.portrait_sheets;
create policy portrait_sheets_owner_select on public.portrait_sheets
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists portrait_sheets_owner_delete on public.portrait_sheets;
create policy portrait_sheets_owner_delete on public.portrait_sheets
  for delete to authenticated using (owner_id = (select auth.uid()));

grant select, delete on public.portrait_sheets to authenticated;

/**
 * The instruction the person carries to an image model.
 *
 * In settings rather than in the app, so it can be corrected without a store
 * release — and the wording matters more than most settings do: every clause
 * about not changing the face is there because an image model will otherwise
 * return a better-looking stranger.
 */
insert into public.app_settings (key, value, description, public_read)
values (
  'portrait.prompt',
  to_jsonb(($prompt$Berilgan rasmni yagona shaxsiy identifikatsiya manbasi sifatida ishlatib, aynan shu insonning bitta ultra-realistik professional 3:4 portret fotosuratini yarat. Yuz va shaxsiyatni mutlaqo o'zgartirma: yuz tuzilishi va proporsiyalari, bosh shakli, peshona, qoshlar, ko'zlar, qovoqlar, burun, lablar, yonoqlar, jag', iyak, quloqlar, teri rangi va teksturasi, tabiiy assimetriya, o'ziga xos belgilar, soch chizig'i, soch turmagi, yosh ko'rinishi va jinsiy ko'rinishi referensdagidek saqlansin. Yuzni chiroyliroq qilish, simmetriklashtirish, yoshartirish, ozdirish, terini plastik silliqlash yoki AI uslubida qayta yaratish taqiqlanadi. Natijadagi inson referensdagi AYNAN O'SHA SHAXS ekanligi shubhasiz ko'rinsin.

Inson kameraga mutlaqo to'g'ri frontal qarasin: bosh tik, burilish va egilishsiz, yelkalar tekis va kameraga parallel, gavda tik, ikkala ko'z to'g'ridan-to'g'ri obyektivga qaragan. Yuz markazi kamera optik o'qi bilan aniq mos tushsin. Ifoda xotirjam, jiddiy va professional, lablar tabiiy yopiq bo'lsin. Kadr yelka/yuqori ko'krak qismidan yuqoriga olinib, bosh 3:4 format markazida to'g'ri joylashtirilsin.

Jinsiga mos rasmiy biznes kiyimi kiydir: erkak bo'lsa — premium to'q rang klassik kostyum, oppoq ko'ylak va sodda to'q galstuk; ayol bo'lsa — nafis konservativ biznes pidjak va oq yoki neytral bluzka. Hech qanday logo, forma yoki ortiqcha aksessuar bo'lmasin.

Fon — haqiqiy fotostudiyadagi sof oq seamless cyclorama, hech qanday chiziq, burchak, tekstura yoki obyektlarsiz. Professional yumshoq frontal studio yoritishi, ko'zlarda tabiiy catchlight, yuzning ikki tomoni bir tekis va tabiiy yoritilgan bo'lsin. 85mm full-frame portret obyektivi, kamera aynan ko'z balandligida, perspektiv buzilishsiz. Ikkala ko'z va butun yuz juda tiniq fokusda; teri poralari, mayda nuqsonlar va individual soch tolalari tabiiy saqlansin. Faqat minimal professional retush.

Natija haqiqiy yuqori darajadagi fotostudiyada olingan fotorealistik, ultra-tiniq, tabiiy rasmiy 3x4 fotosurat ko'rinishida bo'lsin. Eng yuqori ustuvorlik: SAME PERSON, SAME FACE, SAME IDENTITY. Faqat poza, kiyim, oq studio fon, yoritish va kadrni rasmiy portretga moslashtir. Faqat BITTA rasm yarat — kollaj, matn, watermark, ramka yoki alternativ variantlar bo'lmasin.$prompt$)::text),
  '3x4 rasm uchun foydalanuvchiga beriladigan prompt. Ilovani yangilamasdan tahrirlash mumkin.',
  true
)
on conflict (key) do update set
  value = excluded.value,
  description = excluded.description,
  public_read = true;
