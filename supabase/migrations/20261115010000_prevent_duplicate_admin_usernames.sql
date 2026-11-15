-- Prevent Supabase Auth signups from failing when a requested username is already taken.
-- Existing usernames and admin records are preserved. Only the new Auth user's
-- username is given a unique suffix when its requested username conflicts.

begin;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $fn$
declare
  candidate_username text;
  requested_username text;
  username_suffix text;
  suffix_counter integer := 0;
begin
  requested_username := coalesce(
    nullif(left(btrim(coalesce(new.raw_user_meta_data->>'username','')),80),''),
    'user_' || left(replace(new.id::text,'-',''),12)
  );
  candidate_username := requested_username;

  -- Serialize signups requesting the same username to avoid a concurrent
  -- check-then-insert race.
  perform pg_advisory_xact_lock(hashtextextended(requested_username,0));

  if exists (
    select 1 from public.admin_users u
    where u.username = candidate_username
  ) then
    username_suffix := '_' || left(replace(new.id::text,'-',''),10);
    candidate_username := left(requested_username,80-length(username_suffix)) || username_suffix;

    while exists (
      select 1 from public.admin_users u
      where u.username = candidate_username
    ) loop
      suffix_counter := suffix_counter + 1;
      username_suffix := '_' || left(replace(new.id::text,'-',''),8) || '_' || suffix_counter::text;
      candidate_username := left(requested_username,80-length(username_suffix)) || username_suffix;
    end loop;
  end if;

  insert into public.admin_users(
    auth_user_id,full_name,username,email,password_hash,email_verified_at,role,active
  )
  values(
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data->>'full_name','')),160),''),
    candidate_username,
    new.email,
    'SUPABASE_AUTH:' || new.id::text,
    new.email_confirmed_at,
    'editor',
    false
  )
  on conflict(auth_user_id) do update set
    email=excluded.email,
    email_verified_at=excluded.email_verified_at,
    updated_at=now();

  return new;
end;
$fn$;

commit;
