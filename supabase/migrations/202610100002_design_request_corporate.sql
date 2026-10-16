-- Four more styles the create screen may ask for, so the column accepts them:
-- corporate — white ground, one brand colour in large rounded gradient forms,
-- white cards floating on soft shadows; naqsh — national ornament made
-- modern: bodom and girih tilework in the family's gradient, eight-pointed
-- stars, photographs in a bodom-leaf frame; and spektr — an infographic deck:
-- vivid gradient hero pages with a giant white line icon, white content pages
-- where every figure and icon takes its own colour of the spectrum; and
-- mozaika — a Bauhaus mosaic of quarter and half discs, rings, leaves and
-- rays generated cell by cell, beside the words of colour-field hero pages
-- and down one edge of white ones.

alter table public.presentations
  drop constraint if exists presentations_design_request_shape;

alter table public.presentations
  add constraint presentations_design_request_shape check (
    design_request is null or (
      jsonb_typeof(design_request) = 'object'
      and (design_request ->> 'style') in ('glass', 'editorial', 'soft3d', 'corporate', 'naqsh', 'spektr', 'mozaika')
      and (
        design_request -> 'palette' is null
        or jsonb_typeof(design_request -> 'palette') = 'null'
        or (design_request ->> 'palette') in ('blue', 'teal', 'green', 'gold', 'orange', 'red', 'pink', 'violet')
      )
    )
  );

comment on column public.presentations.design_request is
  'The author''s design choice from the create screen: {style: glass|editorial|soft3d|corporate|naqsh|spektr|mozaika, palette: blue|teal|green|gold|orange|red|pink|violet|null}. Null means automatic.';
