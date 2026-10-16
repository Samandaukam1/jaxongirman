/**
 * Yordam markazi: a person and the people who answer them.
 *
 * Every reply here is written by a person — there is no automatic answer, no
 * suggestion, no model anywhere in this desk. A ticket belongs to the person
 * who opened it, who sees its public messages and nothing else; the staff
 * (support agents and managers, and administrators) see every ticket, its
 * internal notes and a narrow slice of the person's account that the ticket
 * may need: their plan, balance and recent orders, not their contacts.
 *
 *   support_tickets      one per question, with its status and priority
 *   support_messages     the conversation; `is_internal` notes are staff-only
 *   support_attachments  screenshots in the private `support-attachments` bucket
 *   support_events       who changed what, when: the ticket's audit trail
 *
 * Writes go through the functions below, never straight to the tables.
 */

/* ------------------------------------------------------------- roles */

create or replace function public.is_support_staff(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user_id
      and role in ('admin'::public.app_role, 'super_admin'::public.app_role,
                   'support_manager'::public.app_role, 'support_agent'::public.app_role)
  );
$$;

create or replace function public.is_support_manager(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user_id
      and role in ('admin'::public.app_role, 'super_admin'::public.app_role, 'support_manager'::public.app_role)
  );
$$;

/** The strongest role, now with the support desk between a user and an administrator. */
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select role
      from public.user_roles
      where user_id = auth.uid()
      order by case role
        when 'super_admin'::public.app_role then 4
        when 'admin'::public.app_role then 3
        when 'support_manager'::public.app_role then 2
        when 'support_agent'::public.app_role then 1
        else 0
      end desc
      limit 1
    ),
    'user'::public.app_role
  );
$$;

/* ------------------------------------------------------------- tables */

create sequence if not exists public.support_ticket_seq;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default ('S-' || lpad(nextval('public.support_ticket_seq')::text, 6, '0')),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in (
    'payments', 'jtanga', 'presentations', 'oyingoh', 'marketplace', 'account', 'technical', 'feedback', 'other')),
  subject text not null check (char_length(btrim(subject)) between 3 and 140),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'waiting_for_user', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee_id uuid references auth.users(id) on delete set null,
  related_order_id uuid references public.orders(id) on delete set null,
  related_transaction_ref text check (related_transaction_ref is null or char_length(related_transaction_ref) <= 120),
  related_presentation_id uuid references public.presentations(id) on delete set null,
  user_unread integer not null default 0 check (user_unread >= 0),
  staff_unread integer not null default 0 check (staff_unread >= 0),
  reopened_count integer not null default 0 check (reopened_count >= 0),
  last_message_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index support_tickets_user on public.support_tickets(user_id, last_message_at desc);
create index support_tickets_queue on public.support_tickets(status, priority, last_message_at desc);
create index support_tickets_assignee on public.support_tickets(assignee_id, status);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_kind text not null check (author_kind in ('user', 'staff', 'system')),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  -- A note the staff leave for each other. Never shown to the person.
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  constraint support_messages_internal_staff check (not (is_internal and author_kind = 'user'))
);

create index support_messages_ticket on public.support_messages(ticket_id, created_at);

create table public.support_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  message_id uuid not null references public.support_messages(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index support_attachments_message on public.support_attachments(message_id);

create table public.support_events (
  id bigserial primary key,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('created', 'status', 'priority', 'assigned', 'reopened', 'replied', 'note')),
  from_value text,
  to_value text,
  created_at timestamptz not null default now()
);

create index support_events_ticket on public.support_events(ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_attachments enable row level security;
alter table public.support_events enable row level security;

create policy support_tickets_read on public.support_tickets for select to authenticated
  using (user_id = auth.uid() or public.is_support_staff(auth.uid()));
create policy support_messages_read on public.support_messages for select to authenticated
  using (
    public.is_support_staff(auth.uid())
    or (not is_internal and exists (
      select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid()))
  );
create policy support_attachments_read on public.support_attachments for select to authenticated
  using (
    public.is_support_staff(auth.uid())
    or exists (
      select 1 from public.support_messages m join public.support_tickets t on t.id = m.ticket_id
       where m.id = message_id and not m.is_internal and t.user_id = auth.uid())
  );
create policy support_events_read on public.support_events for select to authenticated
  using (public.is_support_staff(auth.uid()));

grant select on public.support_tickets, public.support_messages, public.support_attachments, public.support_events to authenticated;
grant all on public.support_tickets, public.support_messages, public.support_attachments, public.support_events to service_role;
grant usage on sequence public.support_events_id_seq, public.support_ticket_seq to service_role;

/* ------------------------------------------------------------- storage */

-- Private: a screenshot of somebody's payment screen is not for anyone else.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-attachments', 'support-attachments', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists support_attachments_upload on storage.objects;
create policy support_attachments_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'support-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists support_attachments_view on storage.objects;
create policy support_attachments_view on storage.objects
  for select to authenticated
  using (
    bucket_id = 'support-attachments' and (
      owner_id = auth.uid()::text
      or public.is_support_staff(auth.uid())
      or exists (
        select 1 from public.support_attachments a
          join public.support_messages m on m.id = a.message_id
          join public.support_tickets t on t.id = a.ticket_id
         where a.storage_path = name and not m.is_internal and t.user_id = auth.uid())
    )
  );

/* ------------------------------------------------------------- helpers */

/** Attaches uploaded files to a message, after checking each is the caller's upload and really there. */
create or replace function public.support_attach(p_ticket_id uuid, p_message_id uuid, p_user_id uuid, p_paths text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_object storage.objects%rowtype;
  v_count integer := 0;
begin
  if coalesce(array_length(p_paths, 1), 0) > 5 then
    raise exception 'Bitta xabarga ko‘pi bilan 5 ta fayl biriktiriladi.' using errcode = '22023';
  end if;
  foreach v_path in array coalesce(p_paths, '{}'::text[]) loop
    if split_part(v_path, '/', 1) <> p_user_id::text then
      raise exception 'attachment does not belong to the sender' using errcode = '42501';
    end if;
    select * into v_object from storage.objects where bucket_id = 'support-attachments' and name = v_path;
    if not found then
      raise exception 'Fayl topilmadi: qayta yuklang.' using errcode = 'P0002';
    end if;
    insert into public.support_attachments (ticket_id, message_id, uploaded_by, storage_path, mime_type, size_bytes)
    values (p_ticket_id, p_message_id, p_user_id, v_path,
            v_object.metadata ->> 'mimetype', nullif(v_object.metadata ->> 'size', '')::bigint);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.support_attach(uuid, uuid, uuid, text[]) from public, anon, authenticated;

/** A ticket with its messages and files, as the caller may see it. */
create or replace function public.support_ticket_json(p_ticket_id uuid, p_staff boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ticket', to_jsonb(t) || jsonb_build_object(
      'assignee_name', (select full_name from public.profiles where id = t.assignee_id),
      'related_order_number', (select order_number from public.orders where id = t.related_order_id),
      'related_presentation_title', (select title from public.presentations where id = t.related_presentation_id)),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'author_kind', m.author_kind, 'is_internal', m.is_internal, 'body', m.body, 'created_at', m.created_at,
        -- The person sees "Yordam xizmati" for staff; staff see who wrote it.
        'author_name', case when m.author_kind = 'staff' and not p_staff then 'Yordam xizmati'
                            else (select full_name from public.profiles where id = m.author_id) end,
        'attachments', coalesce((
          select jsonb_agg(jsonb_build_object('id', a.id, 'path', a.storage_path, 'mime_type', a.mime_type, 'size', a.size_bytes) order by a.created_at)
            from public.support_attachments a where a.message_id = m.id), '[]'::jsonb))
        order by m.created_at)
        from public.support_messages m
       where m.ticket_id = t.id and (p_staff or not m.is_internal)), '[]'::jsonb)
  )
  from public.support_tickets t where t.id = p_ticket_id;
$$;

revoke all on function public.support_ticket_json(uuid, boolean) from public, anon, authenticated;

/* ---------------------------------------------------------- the person */

/**
 * Opens a ticket. A referenced order or deck must be the person's own; at
 * most five new tickets a day and ten open at once, so the desk is not
 * flooded by a stuck button.
 */
create or replace function public.support_create_ticket(
  p_category text,
  p_subject text,
  p_body text,
  p_order_number text default null,
  p_transaction_ref text default null,
  p_presentation_id uuid default null,
  p_attachments text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_order uuid;
  v_ticket public.support_tickets%rowtype;
  v_message uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if (select count(*) from public.support_tickets where user_id = v_user and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Bir kunda ko‘pi bilan 5 ta murojaat yuborish mumkin.' using errcode = 'P0001', detail = 'rate_limited';
  end if;
  if (select count(*) from public.support_tickets where user_id = v_user and status not in ('resolved', 'closed')) >= 10 then
    raise exception 'Sizda 10 ta ochiq murojaat bor. Avvalgilariga javobni kuting.' using errcode = 'P0001', detail = 'too_many_open';
  end if;

  if nullif(btrim(coalesce(p_order_number, '')), '') is not null then
    select id into v_order from public.orders where order_number = btrim(p_order_number) and user_id = v_user;
    if v_order is null then
      raise exception 'Bu raqamli buyurtma sizning hisobingizda topilmadi.' using errcode = 'P0002';
    end if;
  end if;
  if p_presentation_id is not null
     and not exists (select 1 from public.presentations where id = p_presentation_id and owner_id = v_user) then
    raise exception 'Bu taqdimot sizniki emas.' using errcode = '42501';
  end if;

  insert into public.support_tickets (
    user_id, category, subject, related_order_id, related_transaction_ref, related_presentation_id, staff_unread
  ) values (
    v_user, p_category, btrim(p_subject), v_order, nullif(btrim(coalesce(p_transaction_ref, '')), ''), p_presentation_id, 1
  ) returning * into v_ticket;

  insert into public.support_messages (ticket_id, author_id, author_kind, body)
  values (v_ticket.id, v_user, 'user', btrim(p_body))
  returning id into v_message;
  perform public.support_attach(v_ticket.id, v_message, v_user, p_attachments);

  insert into public.support_events (ticket_id, actor_id, kind, to_value) values (v_ticket.id, v_user, 'created', v_ticket.category);
  return jsonb_build_object('id', v_ticket.id, 'ticket_number', v_ticket.ticket_number);
end;
$$;

/** The person writes again. Answering a question the desk asked, or a resolved ticket, opens it. */
create or replace function public.support_reply(p_ticket_id uuid, p_body text, p_attachments text[] default '{}'::text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_ticket public.support_tickets%rowtype;
  v_message uuid;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id and user_id = v_user for update;
  if not found then raise exception 'Murojaat topilmadi.' using errcode = 'P0002'; end if;
  if v_ticket.status = 'closed' then
    raise exception 'Bu murojaat yopilgan. Yangi murojaat yuboring.' using errcode = 'P0001', detail = 'closed';
  end if;
  if (select count(*) from public.support_messages m join public.support_tickets t on t.id = m.ticket_id
       where t.user_id = v_user and m.author_kind = 'user' and m.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Juda ko‘p xabar yuborildi. Birozdan keyin urinib ko‘ring.' using errcode = 'P0001', detail = 'rate_limited';
  end if;

  insert into public.support_messages (ticket_id, author_id, author_kind, body)
  values (p_ticket_id, v_user, 'user', btrim(p_body)) returning id into v_message;
  perform public.support_attach(p_ticket_id, v_message, v_user, p_attachments);

  update public.support_tickets set
    status = case when status in ('waiting_for_user', 'resolved') then 'open' else status end,
    reopened_count = reopened_count + case when status = 'resolved' then 1 else 0 end,
    resolved_at = case when status = 'resolved' then null else resolved_at end,
    staff_unread = staff_unread + 1,
    last_message_at = now(),
    updated_at = now()
  where id = p_ticket_id;

  if v_ticket.status = 'resolved' then
    insert into public.support_events (ticket_id, actor_id, kind, from_value, to_value) values (p_ticket_id, v_user, 'reopened', 'resolved', 'open');
  end if;
  return public.support_ticket_json(p_ticket_id, false);
end;
$$;

/** A resolved ticket opened again by its owner, within 30 days of being resolved. */
create or replace function public.support_reopen(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_ticket public.support_tickets%rowtype;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id and user_id = v_user for update;
  if not found then raise exception 'Murojaat topilmadi.' using errcode = 'P0002'; end if;
  if v_ticket.status <> 'resolved' then
    raise exception 'Faqat hal qilingan murojaatni qayta ochish mumkin.' using errcode = 'P0001';
  end if;
  if v_ticket.resolved_at < now() - interval '30 days' then
    raise exception 'Murojaat 30 kundan oldin hal qilingan. Yangi murojaat yuboring.' using errcode = 'P0001';
  end if;
  update public.support_tickets set status = 'open', resolved_at = null, reopened_count = reopened_count + 1,
    staff_unread = staff_unread + 1, updated_at = now() where id = p_ticket_id;
  insert into public.support_events (ticket_id, actor_id, kind, from_value, to_value) values (p_ticket_id, v_user, 'reopened', 'resolved', 'open');
  return public.support_ticket_json(p_ticket_id, false);
end;
$$;

create or replace function public.my_support_tickets()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'ticket_number', t.ticket_number, 'category', t.category, 'subject', t.subject,
    'status', t.status, 'user_unread', t.user_unread, 'last_message_at', t.last_message_at, 'created_at', t.created_at)
    order by t.last_message_at desc), '[]'::jsonb)
  from public.support_tickets t where t.user_id = auth.uid();
$$;

/** One ticket for the person or for the desk; reading it marks it read for whoever read it. */
create or replace function public.support_ticket_detail(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_staff boolean := public.is_support_staff(v_user);
  v_owner uuid;
begin
  select user_id into v_owner from public.support_tickets where id = p_ticket_id;
  if v_owner is null or (v_owner <> v_user and not v_staff) then
    raise exception 'Murojaat topilmadi.' using errcode = 'P0002';
  end if;
  if v_owner = v_user then
    update public.support_tickets set user_unread = 0 where id = p_ticket_id and user_unread > 0;
  end if;
  if v_staff and v_owner <> v_user then
    update public.support_tickets set staff_unread = 0 where id = p_ticket_id and staff_unread > 0;
  end if;
  return public.support_ticket_json(p_ticket_id, v_staff and v_owner <> v_user);
end;
$$;

create or replace function public.support_unread_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(user_unread), 0)::integer from public.support_tickets where user_id = auth.uid();
$$;

/* ------------------------------------------------------------ the desk */

create or replace function public.support_inbox(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_search text := nullif(btrim(coalesce(v_filters ->> 'search', '')), '');
  v_status text := coalesce(v_filters ->> 'status', 'active');
  v_limit integer := least(greatest(coalesce((v_filters ->> 'limit')::integer, 50), 1), 200);
  v_offset integer := greatest(coalesce((v_filters ->> 'offset')::integer, 0), 0);
begin
  if not public.is_support_staff(v_user) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'tickets', coalesce((
      select jsonb_agg(row_json order by priority_rank desc, last_message_at desc)
      from (
        select jsonb_build_object(
          'id', t.id, 'ticket_number', t.ticket_number, 'category', t.category, 'subject', t.subject,
          'status', t.status, 'priority', t.priority, 'staff_unread', t.staff_unread,
          'assignee_id', t.assignee_id, 'assignee_name', ap.full_name,
          'user_name', up.full_name, 'username', up.username,
          'last_message_at', t.last_message_at, 'created_at', t.created_at) as row_json,
          case t.priority when 'urgent' then 3 when 'high' then 2 when 'normal' then 1 else 0 end as priority_rank,
          t.last_message_at
        from public.support_tickets t
        left join public.profiles up on up.id = t.user_id
        left join public.profiles ap on ap.id = t.assignee_id
        where (v_status = 'all'
               or (v_status = 'active' and t.status in ('open', 'in_progress', 'waiting_for_user'))
               or t.status = v_status)
          and (v_filters ->> 'priority' is null or t.priority = v_filters ->> 'priority')
          and (v_filters ->> 'category' is null or t.category = v_filters ->> 'category')
          and (v_filters ->> 'assignee' is null
               or (v_filters ->> 'assignee' = 'me' and t.assignee_id = v_user)
               or (v_filters ->> 'assignee' = 'unassigned' and t.assignee_id is null)
               or t.assignee_id::text = v_filters ->> 'assignee')
          and (v_search is null
               or t.ticket_number ilike '%' || v_search || '%'
               or t.subject ilike '%' || v_search || '%'
               or up.full_name ilike '%' || v_search || '%'
               or up.username ilike '%' || v_search || '%')
        order by priority_rank desc, t.last_message_at desc
        limit v_limit offset v_offset
      ) rows), '[]'::jsonb),
    'counts', jsonb_build_object(
      'unread', (select count(*) from public.support_tickets where staff_unread > 0 and status not in ('closed')),
      'open', (select count(*) from public.support_tickets where status = 'open'),
      'in_progress', (select count(*) from public.support_tickets where status = 'in_progress'),
      'waiting_for_user', (select count(*) from public.support_tickets where status = 'waiting_for_user'),
      'mine', (select count(*) from public.support_tickets where assignee_id = v_user and status not in ('resolved', 'closed')),
      'unassigned', (select count(*) from public.support_tickets where assignee_id is null and status not in ('resolved', 'closed')))
  );
end;
$$;

/**
 * The desk answers — or leaves a note for itself.
 *
 * A public reply tells the person (a notification that opens the ticket) and,
 * unless told otherwise, leaves the ticket waiting for them. An agent who
 * answers an unassigned ticket takes it.
 */
create or replace function public.support_staff_reply(
  p_ticket_id uuid, p_body text, p_internal boolean default false,
  p_attachments text[] default '{}'::text[], p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_ticket public.support_tickets%rowtype;
  v_message uuid;
  v_status text;
begin
  if not public.is_support_staff(v_user) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'Murojaat topilmadi.' using errcode = 'P0002'; end if;
  if p_status is not null and p_status not in ('open', 'in_progress', 'waiting_for_user', 'resolved', 'closed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  insert into public.support_messages (ticket_id, author_id, author_kind, body, is_internal)
  values (p_ticket_id, v_user, 'staff', btrim(p_body), coalesce(p_internal, false))
  returning id into v_message;
  perform public.support_attach(p_ticket_id, v_message, v_user, p_attachments);

  v_status := coalesce(p_status, case when coalesce(p_internal, false) then v_ticket.status else 'waiting_for_user' end);

  update public.support_tickets set
    status = v_status,
    assignee_id = coalesce(assignee_id, v_user),
    user_unread = user_unread + case when coalesce(p_internal, false) then 0 else 1 end,
    first_response_at = case when coalesce(p_internal, false) then first_response_at else coalesce(first_response_at, now()) end,
    resolved_at = case when v_status = 'resolved' then now() when v_status in ('open', 'in_progress', 'waiting_for_user') then null else resolved_at end,
    closed_at = case when v_status = 'closed' then now() else closed_at end,
    staff_unread = 0,
    last_message_at = case when coalesce(p_internal, false) then last_message_at else now() end,
    updated_at = now()
  where id = p_ticket_id;

  insert into public.support_events (ticket_id, actor_id, kind, to_value)
  values (p_ticket_id, v_user, case when coalesce(p_internal, false) then 'note' else 'replied' end, null);
  if v_status <> v_ticket.status then
    insert into public.support_events (ticket_id, actor_id, kind, from_value, to_value) values (p_ticket_id, v_user, 'status', v_ticket.status, v_status);
  end if;
  if v_ticket.assignee_id is null then
    insert into public.support_events (ticket_id, actor_id, kind, to_value) values (p_ticket_id, v_user, 'assigned', v_user::text);
  end if;

  if not coalesce(p_internal, false) then
    insert into public.notifications (user_id, kind, title, body, payload, deep_link)
    values (
      v_ticket.user_id, 'support_reply',
      'Murojaatingizga javob berildi',
      left(v_ticket.ticket_number || ' · ' || v_ticket.subject, 500),
      jsonb_build_object('event', 'support_reply', 'ticket_id', p_ticket_id, 'ticket_number', v_ticket.ticket_number),
      '/(app)/support/' || p_ticket_id::text
    );
  end if;
  return public.support_ticket_json(p_ticket_id, true);
end;
$$;

/**
 * Status, priority and owner. An agent may take a ticket or let it go; only a
 * manager hands one to somebody else. Resolving or closing tells the person.
 */
create or replace function public.support_update_ticket(
  p_ticket_id uuid, p_status text default null, p_priority text default null,
  p_assignee_id uuid default null, p_unassign boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_ticket public.support_tickets%rowtype;
  v_status text;
  v_priority text;
  v_assignee uuid;
begin
  if not public.is_support_staff(v_user) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'Murojaat topilmadi.' using errcode = 'P0002'; end if;

  v_status := coalesce(p_status, v_ticket.status);
  v_priority := coalesce(p_priority, v_ticket.priority);
  v_assignee := case when coalesce(p_unassign, false) then null else coalesce(p_assignee_id, v_ticket.assignee_id) end;

  if v_assignee is distinct from v_ticket.assignee_id
     and v_assignee is distinct from v_user and v_assignee is not null
     and not public.is_support_manager(v_user) then
    raise exception 'Murojaatni boshqa xodimga faqat menejer biriktiradi.' using errcode = '42501';
  end if;
  if v_assignee is not null and not public.is_support_staff(v_assignee) then
    raise exception 'Bu foydalanuvchi support xodimi emas.' using errcode = '22023';
  end if;
  if v_ticket.assignee_id is not null and v_assignee is null and v_ticket.assignee_id <> v_user
     and not public.is_support_manager(v_user) then
    raise exception 'Boshqa xodimning murojaatini faqat menejer bo‘shatadi.' using errcode = '42501';
  end if;

  update public.support_tickets set
    status = v_status, priority = v_priority, assignee_id = v_assignee,
    resolved_at = case when v_status = 'resolved' and v_ticket.status <> 'resolved' then now()
                       when v_status in ('open', 'in_progress', 'waiting_for_user') then null else resolved_at end,
    closed_at = case when v_status = 'closed' and v_ticket.status <> 'closed' then now()
                     when v_status <> 'closed' then null else closed_at end,
    updated_at = now()
  where id = p_ticket_id;

  if v_status <> v_ticket.status then
    insert into public.support_events (ticket_id, actor_id, kind, from_value, to_value) values (p_ticket_id, v_user, 'status', v_ticket.status, v_status);
    if v_status in ('resolved', 'closed') then
      insert into public.notifications (user_id, kind, title, body, payload, deep_link)
      values (v_ticket.user_id, 'support_reply',
              case v_status when 'resolved' then 'Murojaatingiz hal qilindi' else 'Murojaatingiz yopildi' end,
              left(v_ticket.ticket_number || ' · ' || v_ticket.subject, 500),
              jsonb_build_object('event', 'support_status', 'ticket_id', p_ticket_id, 'status', v_status),
              '/(app)/support/' || p_ticket_id::text);
      update public.support_tickets set user_unread = user_unread + 1 where id = p_ticket_id;
    end if;
  end if;
  if v_priority <> v_ticket.priority then
    insert into public.support_events (ticket_id, actor_id, kind, from_value, to_value) values (p_ticket_id, v_user, 'priority', v_ticket.priority, v_priority);
  end if;
  if v_assignee is distinct from v_ticket.assignee_id then
    insert into public.support_events (ticket_id, actor_id, kind, from_value, to_value)
    values (p_ticket_id, v_user, 'assigned', v_ticket.assignee_id::text, v_assignee::text);
  end if;
  return public.support_ticket_json(p_ticket_id, true);
end;
$$;

/**
 * What the desk may know about the person behind a ticket: enough to answer
 * it — their name, plan, balances and recent orders, and the order or deck the
 * ticket names — and not their email, phone or anything else.
 */
create or replace function public.support_ticket_context(p_ticket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets%rowtype;
begin
  if not public.is_support_staff(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if not found then raise exception 'Murojaat topilmadi.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'user', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'username', p.username, 'status', p.status,
                                       'joined_at', u.created_at)
               from public.profiles p join auth.users u on u.id = p.id where p.id = v_ticket.user_id),
    'plan', (select jsonb_build_object('code', sp.code, 'name', sp.name, 'expires_at', s.expires_at)
               from public.user_subscriptions s join public.subscription_plans sp on sp.id = s.plan_id
              where s.user_id = v_ticket.user_id and s.status = 'active' and s.expires_at > now()
              order by s.expires_at desc limit 1),
    'wallet', (select jsonb_build_object('balance', w.balance, 'reserved', w.reserved) from public.credit_wallets w where w.user_id = v_ticket.user_id),
    'pages', (select jsonb_build_object(
                'welcome', coalesce(sum(pages_remaining) filter (where source = 'welcome'), 0),
                'bought', coalesce(sum(pages_remaining) filter (where source <> 'welcome'), 0))
               from public.presentation_credit_grants where user_id = v_ticket.user_id),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('order_number', o.order_number, 'purpose', o.purpose, 'status', o.status,
                                                            'total_amount', o.total_amount, 'created_at', o.created_at, 'paid_at', o.paid_at)
                                         order by o.created_at desc)
                          from (select * from public.orders where user_id = v_ticket.user_id order by created_at desc limit 5) o), '[]'::jsonb),
    'related_order', (select jsonb_build_object('order_number', o.order_number, 'purpose', o.purpose, 'status', o.status,
                                                'total_amount', o.total_amount, 'created_at', o.created_at, 'paid_at', o.paid_at,
                                                'failure_message', o.failure_message)
                        from public.orders o where o.id = v_ticket.related_order_id),
    'related_presentation', (select jsonb_build_object('id', pr.id, 'title', pr.title, 'status', pr.status,
                                                       'slides', pr.requested_slide_count, 'created_at', pr.created_at,
                                                       'error_message', pr.error_message)
                               from public.presentations pr where pr.id = v_ticket.related_presentation_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'from', e.from_value, 'to', e.to_value,
                                                            'actor', (select full_name from public.profiles where id = e.actor_id),
                                                            'created_at', e.created_at) order by e.created_at)
                          from public.support_events e where e.ticket_id = p_ticket_id), '[]'::jsonb)
  );
end;
$$;

/** Who works the desk, for the assignment list. */
create or replace function public.support_staff_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_support_staff(auth.uid()) then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('id', r.user_id, 'full_name', p.full_name, 'role', r.role) order by p.full_name)
      from (select distinct on (user_id) user_id, role from public.user_roles
             where role in ('support_manager', 'support_agent', 'admin', 'super_admin')
             order by user_id, case role when 'super_admin' then 4 when 'admin' then 3 when 'support_manager' then 2 else 1 end desc) r
      left join public.profiles p on p.id = r.user_id), '[]'::jsonb) end;
$$;

/** Gives or takes a support role, by email. Super admins only; written to the audit log. */
create or replace function public.admin_set_support_role(p_email text, p_role text, p_grant boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_target uuid;
begin
  if not public.is_super_admin(v_admin) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('support_manager', 'support_agent') then raise exception 'invalid support role' using errcode = '22023'; end if;
  select id into v_target from auth.users where lower(email) = lower(btrim(p_email));
  if v_target is null then raise exception 'Bu email bilan foydalanuvchi topilmadi.' using errcode = 'P0002'; end if;

  if p_grant then
    insert into public.user_roles (user_id, role, granted_by) values (v_target, p_role::public.app_role, v_admin)
      on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles where user_id = v_target and role = p_role::public.app_role;
  end if;
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_admin, case when p_grant then 'support_role.granted' else 'support_role.revoked' end, 'user', v_target::text,
          jsonb_build_object('role', p_role));
  return jsonb_build_object('user_id', v_target, 'role', p_role, 'granted', p_grant);
end;
$$;

/** How the desk is doing, from what it actually did. */
create or replace function public.support_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_support_staff(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'open_total', (select count(*) from public.support_tickets where status in ('open', 'in_progress', 'waiting_for_user')),
    'created_7d', (select count(*) from public.support_tickets where created_at > now() - interval '7 days'),
    'resolved_7d', (select count(*) from public.support_tickets where resolved_at > now() - interval '7 days'),
    'median_first_response_minutes_30d', (
      select round(extract(epoch from percentile_cont(0.5) within group (order by first_response_at - created_at)) / 60)
        from public.support_tickets where first_response_at is not null and created_at > now() - interval '30 days'),
    'by_category_30d', coalesce((select jsonb_object_agg(category, n) from (
      select category, count(*) as n from public.support_tickets where created_at > now() - interval '30 days' group by category) c), '{}'::jsonb)
  );
end;
$$;

/* ------------------------------------------------------------- grants */

revoke all on function public.support_create_ticket(text, text, text, text, text, uuid, text[]) from public, anon;
revoke all on function public.support_reply(uuid, text, text[]) from public, anon;
revoke all on function public.support_reopen(uuid) from public, anon;
revoke all on function public.my_support_tickets() from public, anon;
revoke all on function public.support_ticket_detail(uuid) from public, anon;
revoke all on function public.support_unread_count() from public, anon;
revoke all on function public.support_inbox(jsonb) from public, anon;
revoke all on function public.support_staff_reply(uuid, text, boolean, text[], text) from public, anon;
revoke all on function public.support_update_ticket(uuid, text, text, uuid, boolean) from public, anon;
revoke all on function public.support_ticket_context(uuid) from public, anon;
revoke all on function public.support_staff_list() from public, anon;
revoke all on function public.admin_set_support_role(text, text, boolean) from public, anon;
revoke all on function public.support_metrics() from public, anon;
revoke all on function public.is_support_staff(uuid) from public, anon;
revoke all on function public.is_support_manager(uuid) from public, anon;

grant execute on function public.support_create_ticket(text, text, text, text, text, uuid, text[]) to authenticated;
grant execute on function public.support_reply(uuid, text, text[]) to authenticated;
grant execute on function public.support_reopen(uuid) to authenticated;
grant execute on function public.my_support_tickets() to authenticated;
grant execute on function public.support_ticket_detail(uuid) to authenticated;
grant execute on function public.support_unread_count() to authenticated;
grant execute on function public.support_inbox(jsonb) to authenticated;
grant execute on function public.support_staff_reply(uuid, text, boolean, text[], text) to authenticated;
grant execute on function public.support_update_ticket(uuid, text, text, uuid, boolean) to authenticated;
grant execute on function public.support_ticket_context(uuid) to authenticated;
grant execute on function public.support_staff_list() to authenticated;
grant execute on function public.admin_set_support_role(text, text, boolean) to authenticated;
grant execute on function public.support_metrics() to authenticated;
grant execute on function public.is_support_staff(uuid) to authenticated;
grant execute on function public.is_support_manager(uuid) to authenticated;
