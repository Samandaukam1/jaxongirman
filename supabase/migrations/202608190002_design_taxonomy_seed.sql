-- The subjects a design can be for.
--
-- A hundred and one of them, grouped the way the work is grouped rather than
-- alphabetically, because an admin scanning for "the medical one" is looking
-- for a neighbourhood and not a letter.
--
-- Closed on purpose: a classifier free to invent labels writes "Tibbiyot",
-- "Meditsina" and "Sog'liqni saqlash" for one idea, and a selector comparing
-- free text is comparing spelling. The synonyms below are how those three
-- still find the topic — the deck's subject arrives in whichever word the
-- author happened to type, and in whichever language.


-- Tibbiyot va biologiya
insert into public.design_topics (slug, label_uz, family, sort_order) values ('tibbiyot', 'Tibbiyot', 'Tibbiyot va biologiya', 1) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('kardiologiya', 'Kardiologiya', 'Tibbiyot va biologiya', 2) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('stomatologiya', 'Stomatologiya', 'Tibbiyot va biologiya', 3) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('farmatsevtika', 'Farmatsevtika', 'Tibbiyot va biologiya', 4) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('hamshiralik', 'Hamshiralik', 'Tibbiyot va biologiya', 5) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('biologiya', 'Biologiya', 'Tibbiyot va biologiya', 6) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('biotexnologiya', 'Biotexnologiya', 'Tibbiyot va biologiya', 7) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('veterinariya', 'Veterinariya', 'Tibbiyot va biologiya', 8) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('psixologiya', 'Psixologiya', 'Tibbiyot va biologiya', 9) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;

-- Aniq fanlar
insert into public.design_topics (slug, label_uz, family, sort_order) values ('kimyo', 'Kimyo', 'Aniq fanlar', 10) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('fizika', 'Fizika', 'Aniq fanlar', 11) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('matematika', 'Matematika', 'Aniq fanlar', 12) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('astronomiya', 'Astronomiya', 'Aniq fanlar', 13) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('statistika', 'Statistika', 'Aniq fanlar', 14) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('ilmiy-tadqiqot', 'Ilmiy tadqiqot', 'Aniq fanlar', 15) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('materialshunoslik', 'Materialshunoslik', 'Aniq fanlar', 16) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;

-- Yer va tabiat
insert into public.design_topics (slug, label_uz, family, sort_order) values ('geografiya', 'Geografiya', 'Yer va tabiat', 17) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('ekologiya', 'Ekologiya', 'Yer va tabiat', 18) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('geologiya', 'Geologiya', 'Yer va tabiat', 19) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('qishloq-xojaligi', 'Qishloq xo''jaligi', 'Yer va tabiat', 20) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('demografiya', 'Demografiya', 'Yer va tabiat', 21) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;

-- Sanoat va energetika
insert into public.design_topics (slug, label_uz, family, sort_order) values ('konchilik', 'Konchilik', 'Sanoat va energetika', 22) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('neft-va-gaz', 'Neft va gaz', 'Sanoat va energetika', 23) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('energetika', 'Energetika', 'Sanoat va energetika', 24) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('elektr-energetikasi', 'Elektr energetikasi', 'Sanoat va energetika', 25) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('metallurgiya', 'Metallurgiya', 'Sanoat va energetika', 26) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('toqimachilik', 'To''qimachilik', 'Sanoat va energetika', 27) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('ishlab-chiqarish', 'Ishlab chiqarish', 'Sanoat va energetika', 28) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('sanoat', 'Sanoat', 'Sanoat va energetika', 29) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('oziq-ovqat', 'Oziq-ovqat', 'Sanoat va energetika', 30) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;

-- Qurilish va muhandislik
insert into public.design_topics (slug, label_uz, family, sort_order) values ('qurilish', 'Qurilish', 'Qurilish va muhandislik', 31) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('arxitektura', 'Arxitektura', 'Qurilish va muhandislik', 32) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('muhandislik', 'Muhandislik', 'Qurilish va muhandislik', 33) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('mexanika', 'Mexanika', 'Qurilish va muhandislik', 34) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('shaharsozlik', 'Shaharsozlik', 'Qurilish va muhandislik', 35) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('kochmas-mulk', 'Ko''chmas mulk', 'Qurilish va muhandislik', 36) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;

-- Transport
insert into public.design_topics (slug, label_uz, family, sort_order) values ('avtomobil', 'Avtomobil', 'Transport', 37) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('transport', 'Transport', 'Transport', 38) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('aviatsiya', 'Aviatsiya', 'Transport', 39) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('logistika', 'Logistika', 'Transport', 40) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;

-- Texnologiya
insert into public.design_topics (slug, label_uz, family, sort_order) values ('texnologiya', 'Texnologiya', 'Texnologiya', 41) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('axborot-texnologiyalari', 'Axborot texnologiyalari', 'Texnologiya', 42) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('suniy-intellekt', 'Sun''iy intellekt', 'Texnologiya', 43) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('dasturlash', 'Dasturlash', 'Texnologiya', 44) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('kiberxavfsizlik', 'Kiberxavfsizlik', 'Texnologiya', 45) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('data-science', 'Data Science', 'Texnologiya', 46) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('robototexnika', 'Robototexnika', 'Texnologiya', 47) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('telekommunikatsiya', 'Telekommunikatsiya', 'Texnologiya', 48) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('elektronika', 'Elektronika', 'Texnologiya', 49) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('innovatsiya', 'Innovatsiya', 'Texnologiya', 50) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;

-- Biznes va moliya
insert into public.design_topics (slug, label_uz, family, sort_order) values ('biznes', 'Biznes', 'Biznes va moliya', 51) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('menejment', 'Menejment', 'Biznes va moliya', 52) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('marketing', 'Marketing', 'Biznes va moliya', 53) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('smm', 'SMM', 'Biznes va moliya', 54) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('savdo', 'Savdo', 'Biznes va moliya', 55) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('elektron-tijorat', 'Elektron tijorat', 'Biznes va moliya', 56) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('moliya', 'Moliya', 'Biznes va moliya', 57) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('bank', 'Bank', 'Biznes va moliya', 58) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('buxgalteriya', 'Buxgalteriya', 'Biznes va moliya', 59) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('audit', 'Audit', 'Biznes va moliya', 60) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('investitsiya', 'Investitsiya', 'Biznes va moliya', 61) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('iqtisodiyot', 'Iqtisodiyot', 'Biznes va moliya', 62) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('sugurta', 'Sug''urta', 'Biznes va moliya', 63) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('tadbirkorlik', 'Tadbirkorlik', 'Biznes va moliya', 64) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('startap', 'Startap', 'Biznes va moliya', 65) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('hr', 'HR', 'Biznes va moliya', 66) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('liderlik', 'Liderlik', 'Biznes va moliya', 67) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('project-management', 'Project Management', 'Biznes va moliya', 68) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('korporativ-hisobot', 'Korporativ hisobot', 'Biznes va moliya', 69) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('portfolio', 'Portfolio', 'Biznes va moliya', 70) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('cv', 'CV', 'Biznes va moliya', 71) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;

-- Huquq va davlat
insert into public.design_topics (slug, label_uz, family, sort_order) values ('huquq', 'Huquq', 'Huquq va davlat', 72) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('davlat-boshqaruvi', 'Davlat boshqaruvi', 'Huquq va davlat', 73) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('siyosatshunoslik', 'Siyosatshunoslik', 'Huquq va davlat', 74) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('xalqaro-munosabatlar', 'Xalqaro munosabatlar', 'Huquq va davlat', 75) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('diplomatiya', 'Diplomatiya', 'Huquq va davlat', 76) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('xavfsizlik', 'Xavfsizlik', 'Huquq va davlat', 77) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('harbiy-soha', 'Harbiy soha', 'Huquq va davlat', 78) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('favqulodda-vaziyat', 'Favqulodda vaziyat', 'Huquq va davlat', 79) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;

-- Gumanitar fanlar
insert into public.design_topics (slug, label_uz, family, sort_order) values ('tarix', 'Tarix', 'Gumanitar fanlar', 80) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('arxeologiya', 'Arxeologiya', 'Gumanitar fanlar', 81) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('adabiyot', 'Adabiyot', 'Gumanitar fanlar', 82) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('ozbek-adabiyoti', 'O''zbek adabiyoti', 'Gumanitar fanlar', 83) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('tilshunoslik', 'Tilshunoslik', 'Gumanitar fanlar', 84) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('filologiya', 'Filologiya', 'Gumanitar fanlar', 85) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('falsafa', 'Falsafa', 'Gumanitar fanlar', 86) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('sotsiologiya', 'Sotsiologiya', 'Gumanitar fanlar', 87) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;

-- Media va ta'lim
insert into public.design_topics (slug, label_uz, family, sort_order) values ('jurnalistika', 'Jurnalistika', 'Media va ta''lim', 88) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('media', 'Media', 'Media va ta''lim', 89) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('pr', 'PR', 'Media va ta''lim', 90) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('talim', 'Ta''lim', 'Media va ta''lim', 91) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('pedagogika', 'Pedagogika', 'Media va ta''lim', 92) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;

-- Madaniyat va san'at
insert into public.design_topics (slug, label_uz, family, sort_order) values ('madaniyat', 'Madaniyat', 'Madaniyat va san''at', 93) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('sanat', 'San''at', 'Madaniyat va san''at', 94) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('dizayn', 'Dizayn', 'Madaniyat va san''at', 95) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('grafik-dizayn', 'Grafik dizayn', 'Madaniyat va san''at', 96) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('moda', 'Moda', 'Madaniyat va san''at', 97) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('interyer', 'Interyer', 'Madaniyat va san''at', 98) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('fotografiya', 'Fotografiya', 'Madaniyat va san''at', 99) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('kino', 'Kino', 'Madaniyat va san''at', 100) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('musiqa', 'Musiqa', 'Madaniyat va san''at', 101) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;

-- Xizmatlar
insert into public.design_topics (slug, label_uz, family, sort_order) values ('sport', 'Sport', 'Xizmatlar', 102) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('turizm', 'Turizm', 'Xizmatlar', 103) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('mehmonxona', 'Mehmonxona', 'Xizmatlar', 104) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;
insert into public.design_topics (slug, label_uz, family, sort_order) values ('restoran', 'Restoran', 'Xizmatlar', 105) on conflict (slug) do update set label_uz = excluded.label_uz, family = excluded.family, sort_order = excluded.sort_order;

-- Every topic answers to its own name before it answers to anything else.
insert into public.design_topic_synonyms (topic_id, term, normalized)
select t.id, t.label_uz, regexp_replace(lower(translate(t.label_uz, '''‘’', '')), '[^a-z0-9а-яё ]+', ' ', 'g')
  from public.design_topics t
on conflict (normalized) do nothing;

insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'AI', 'ai' from public.design_topics where slug = 'suniy-intellekt' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'artificial intelligence', 'artificial intelligence' from public.design_topics where slug = 'suniy-intellekt' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'yapon intellekt', 'yapon intellekt' from public.design_topics where slug = 'suniy-intellekt' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'suniy intellekt', 'suniy intellekt' from public.design_topics where slug = 'suniy-intellekt' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'искусственный интеллект', 'искусственныи интеллект' from public.design_topics where slug = 'suniy-intellekt' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'meditsina', 'meditsina' from public.design_topics where slug = 'tibbiyot' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'sog''liqni saqlash', 'sogliqni saqlash' from public.design_topics where slug = 'tibbiyot' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'medicine', 'medicine' from public.design_topics where slug = 'tibbiyot' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'health', 'health' from public.design_topics where slug = 'tibbiyot' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'медицина', 'медицина' from public.design_topics where slug = 'tibbiyot' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'IT', 'it' from public.design_topics where slug = 'axborot-texnologiyalari' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'information technology', 'information technology' from public.design_topics where slug = 'axborot-texnologiyalari' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'ахборот технологиялари', 'ахборот технологиялари' from public.design_topics where slug = 'axborot-texnologiyalari' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'programming', 'programming' from public.design_topics where slug = 'dasturlash' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'coding', 'coding' from public.design_topics where slug = 'dasturlash' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'software', 'software' from public.design_topics where slug = 'dasturlash' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'cybersecurity', 'cybersecurity' from public.design_topics where slug = 'kiberxavfsizlik' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'axborot xavfsizligi', 'axborot xavfsizligi' from public.design_topics where slug = 'kiberxavfsizlik' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'economics', 'economics' from public.design_topics where slug = 'iqtisodiyot' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'ekonomika', 'ekonomika' from public.design_topics where slug = 'iqtisodiyot' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'экономика', 'экономика' from public.design_topics where slug = 'iqtisodiyot' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'literature', 'literature' from public.design_topics where slug = 'adabiyot' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'литература', 'литература' from public.design_topics where slug = 'adabiyot' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'uzbek literature', 'uzbek literature' from public.design_topics where slug = 'ozbek-adabiyoti' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'milliy adabiyot', 'milliy adabiyot' from public.design_topics where slug = 'ozbek-adabiyoti' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'mining', 'mining' from public.design_topics where slug = 'konchilik' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'kon sanoati', 'kon sanoati' from public.design_topics where slug = 'konchilik' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'горное дело', 'горное дело' from public.design_topics where slug = 'konchilik' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'oil and gas', 'oil and gas' from public.design_topics where slug = 'neft-va-gaz' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'neft-gaz', 'neft gaz' from public.design_topics where slug = 'neft-va-gaz' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'agriculture', 'agriculture' from public.design_topics where slug = 'qishloq-xojaligi' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'agro', 'agro' from public.design_topics where slug = 'qishloq-xojaligi' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'dehqonchilik', 'dehqonchilik' from public.design_topics where slug = 'qishloq-xojaligi' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'marketing', 'marketing' from public.design_topics where slug = 'marketing' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'reklama', 'reklama' from public.design_topics where slug = 'marketing' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'finance', 'finance' from public.design_topics where slug = 'moliya' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'финансы', 'финансы' from public.design_topics where slug = 'moliya' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'education', 'education' from public.design_topics where slug = 'talim' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'обучение', 'обучение' from public.design_topics where slug = 'talim' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'o''qitish', 'oqitish' from public.design_topics where slug = 'talim' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'sport', 'sport' from public.design_topics where slug = 'sport' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'jismoniy tarbiya', 'jismoniy tarbiya' from public.design_topics where slug = 'sport' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'history', 'history' from public.design_topics where slug = 'tarix' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'история', 'история' from public.design_topics where slug = 'tarix' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'ecology', 'ecology' from public.design_topics where slug = 'ekologiya' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'atrof-muhit', 'atrof muhit' from public.design_topics where slug = 'ekologiya' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'экология', 'экология' from public.design_topics where slug = 'ekologiya' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'robotics', 'robotics' from public.design_topics where slug = 'robototexnika' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'robot', 'robot' from public.design_topics where slug = 'robototexnika' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'ma''lumotlar tahlili', 'malumotlar tahlili' from public.design_topics where slug = 'data-science' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'data analytics', 'data analytics' from public.design_topics where slug = 'data-science' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'big data', 'big data' from public.design_topics where slug = 'data-science' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'loyiha boshqaruvi', 'loyiha boshqaruvi' from public.design_topics where slug = 'project-management' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'PM', 'pm' from public.design_topics where slug = 'project-management' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'startup', 'startup' from public.design_topics where slug = 'startap' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'management', 'management' from public.design_topics where slug = 'menejment' on conflict (normalized) do nothing;
insert into public.design_topic_synonyms (topic_id, term, normalized) select id, 'boshqaruv', 'boshqaruv' from public.design_topics where slug = 'menejment' on conflict (normalized) do nothing;
