-- Add source column to track how address was added (manual, fcl, local-key)
-- local-key addresses can deploy; others are view-only
ALTER TABLE public.runner_verified_addresses
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
