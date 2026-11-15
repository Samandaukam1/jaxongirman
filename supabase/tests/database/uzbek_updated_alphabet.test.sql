begin;
select plan(9);

-- The two alphabets grade as one.
select is(public.game_normalize_text('Toşkent'), public.game_normalize_text('Toshkent'), 'Ş and Sh are the same answer');
select is(public.game_normalize_text('Özbekiston'), public.game_normalize_text('O‘zbekiston'), 'Ö and O‘ are the same answer');
select is(public.game_normalize_text('ÖZBEKISTON'), public.game_normalize_text('o''zbekiston'), 'capitals fold too');
select is(public.game_normalize_text('Çöl'), public.game_normalize_text('cho‘l'), 'Ç and Ch, ö and o‘ in one word');
select is(public.game_normalize_text('Tog‘'), public.game_normalize_text('Toğ'), 'Ğ and G‘ are the same answer');
select is(public.game_normalize_text('ŞAHAR'), 'shahar', 'a capital Ş folds to sh whatever the ctype');

-- What it folded before still folds, and different words stay different.
select is(public.game_normalize_text('  Ёлка  '), 'елка', 'Russian ё still reads as е');
select is(public.game_normalize_text('«Ma’lumot»'), 'ma''lumot', 'quotes dropped, the tutuq belgisi kept');
select isnt(public.game_normalize_text('sahar'), public.game_normalize_text('shahar'), 's and sh are not the same letter');

select * from finish();
rollback;
