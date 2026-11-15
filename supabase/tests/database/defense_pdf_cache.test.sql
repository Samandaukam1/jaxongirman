begin;
select plan(3);

select has_column('public', 'presentation_defenses', 'pdf_path', 'the kept script PDF has a place');
select has_column('public', 'presentation_defenses', 'pdf_rendered_at', 'and a time it was made');
select col_is_null('public', 'presentation_defenses', 'pdf_path', 'a script without a file yet is allowed');

select * from finish();
rollback;
