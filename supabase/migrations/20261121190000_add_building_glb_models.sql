-- Store one optional GLB model for each campus building.
alter table public.locations
  add column if not exists model_3d_path varchar(255);

comment on column public.locations.model_3d_path is
  'Storage object path for the building GLB model in the campus-models bucket.';

-- Private storage bucket for uploaded building GLB files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'campus-models',
  'campus-models',
  false,
  104857600,
  array['model/gltf-binary', 'application/octet-stream']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists campus_models_editor_insert on storage.objects;
create policy campus_models_editor_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'campus-models' and (select public.has_admin_role('editor')));

drop policy if exists campus_models_editor_update on storage.objects;
create policy campus_models_editor_update
on storage.objects for update to authenticated
using (bucket_id = 'campus-models' and (select public.has_admin_role('editor')))
with check (bucket_id = 'campus-models' and (select public.has_admin_role('editor')));

drop policy if exists campus_models_editor_delete on storage.objects;
create policy campus_models_editor_delete
on storage.objects for delete to authenticated
using (bucket_id = 'campus-models' and (select public.has_admin_role('editor')));
