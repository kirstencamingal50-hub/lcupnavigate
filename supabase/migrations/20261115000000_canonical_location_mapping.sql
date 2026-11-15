-- Preserve alternate directory names while linking them to one physical map location.
-- Safe to run on deployments where this column was added manually already.
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS canonical_location_id BIGINT
  REFERENCES public.locations(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN public.locations.canonical_location_id IS
  'Optional canonical locations.id used as the shared map/navigation target for alternate directory records.';
