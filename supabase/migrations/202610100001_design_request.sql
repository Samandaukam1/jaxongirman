-- What the author asked of the design, when they asked anything.
--
-- The create screen leaves "Avtomatik dizayn" on by default, and then this is
-- null: the generator picks the style (the opposite of the author's last deck)
-- and the colour from the topic. Turned off, the author names a style — glass,
-- editorial (jurnal) or soft3d — and optionally a colour family; the generator
-- still invents everything else. Only these words are ever stored: the edge
-- function writes the column with the service role after checking them, and
-- the constraint holds the same list.

alter table public.presentations
  add column if not exists design_request jsonb;

alter table public.presentations
  drop constraint if exists presentations_design_request_shape;

alter table public.presentations
  add constraint presentations_design_request_shape check (
    design_request is null or (
      jsonb_typeof(design_request) = 'object'
      and (design_request ->> 'style') in ('glass', 'editorial', 'soft3d')
      and (
        design_request -> 'palette' is null
        or jsonb_typeof(design_request -> 'palette') = 'null'
        or (design_request ->> 'palette') in ('blue', 'teal', 'green', 'gold', 'orange', 'red', 'pink', 'violet')
      )
    )
  );

comment on column public.presentations.design_request is
  'The author''s design choice from the create screen: {style: glass|editorial|soft3d, palette: blue|teal|green|gold|orange|red|pink|violet|null}. Null means automatic.';
