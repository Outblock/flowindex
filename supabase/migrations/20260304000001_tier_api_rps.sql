-- Add per-tier RPS column for public API rate limiting.
-- free=20, pro=50, enterprise=200, ultimate=unlimited
ALTER TABLE public.rate_limit_tiers ADD COLUMN IF NOT EXISTS api_rps INT NOT NULL DEFAULT 20;

UPDATE public.rate_limit_tiers SET api_rps = 20     WHERE id = 'free';
UPDATE public.rate_limit_tiers SET api_rps = 50     WHERE id = 'pro';
UPDATE public.rate_limit_tiers SET api_rps = 200    WHERE id = 'enterprise';
UPDATE public.rate_limit_tiers SET api_rps = 999999 WHERE id = 'ultimate';
