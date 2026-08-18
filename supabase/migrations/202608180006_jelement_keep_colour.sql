-- Some colours are the object.
--
-- An element recolours with the deck it lands on: the design says its accent is
-- amber and the library serves the amber render. That is right for a
-- stethoscope, whose lime trim is a house style, and wrong for a first aid
-- box, whose cross is red because a red cross is what it means. Shifting that
-- hue does not restyle the object, it makes it something else.
--
-- So an element may decline. The default is to follow the deck, because most
-- objects should and because that is what every element already does; declining
-- is the exception an analyzer has to state deliberately.

alter table public.jelements
  add column if not exists asset_recolorable boolean not null default true;

comment on column public.jelements.asset_recolorable is
  'False when the object''s colour is part of what it is — a red cross, a national flag, a blood sample. Such an element keeps its own render whatever accent the deck asks for.';
