-- Uzbek in the updated Latin alphabet: O‘ → Ö, G‘ → Ğ, Sh → Ş, Ch → Ç.
--
-- The app now shows Uzbek — and writes every generated game — in the updated
-- alphabet, while people keep typing whichever their keyboard gives them. A
-- typed answer is graded by comparing normalised text, so the normaliser folds
-- the two alphabets together: «Toşkent» and «Toshkent», «Özbekiston» and
-- «O‘zbekiston» are the same answer. Nothing else about grading changes.
--
-- The new letters are folded back to the old spelling (ö → o', ğ → g',
-- ş → sh, ç → ch) before `lower`, in both cases, so the result does not depend
-- on the database's ctype: under the C locale `lower` leaves Ş alone.

/**
 * Text the grader can compare. Lowercase, outer and doubled spaces gone, every
 * apostrophe variant folded to one, quotation marks dropped, «ё» read as «е»,
 * and the updated Uzbek letters read as the current alphabet's.
 */
create or replace function public.game_normalize_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    translate(lower(
      replace(replace(replace(replace(replace(replace(replace(replace(
        translate(coalesce(p_value, ''), 'ʻʼ''`´’‘“”«»', repeat('''', 7)),
        'Ö', 'O'''), 'ö', 'o'''),
        'Ğ', 'G'''), 'ğ', 'g'''),
        'Ş', 'Sh'), 'ş', 'sh'),
        'Ç', 'Ch'), 'ç', 'ch')
    ), 'ё', 'е'),
    '\s+', ' ', 'g'
  ));
$$;

comment on function public.game_normalize_text(text) is
  'Grading key for typed answers: case, spaces, apostrophes, ё/е and the two Uzbek Latin alphabets (Ö/O‘, Ğ/G‘, Ş/Sh, Ç/Ch) folded together.';
