-- Store one optional GLB model for each campus building.
alter table public.locations
  add column if not exists model_3d_path varchar(255);

comment on column public.locations.model_3d_path is
  'Storage object path for the building GLB model in the campus-models bucket.';
