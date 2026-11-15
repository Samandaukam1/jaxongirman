-- A crossword is an O‘yingoh question of its own type: one question that holds
-- the whole grid (see 202611150011_crosswords.sql).
--
-- On its own, because a new enum value cannot be used in the transaction that
-- adds it, and the next migration's constraint and functions use it.
alter type public.game_question_type add value if not exists 'crossword';
