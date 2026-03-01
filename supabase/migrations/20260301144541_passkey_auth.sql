CREATE TABLE IF NOT EXISTS public.passkey_credentials (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  webauthn_user_id TEXT NOT NULL,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_type VARCHAR(32) NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up BOOLEAN NOT NULL DEFAULT false,
  transports TEXT[],
  authenticator_name VARCHAR(255),
  aaguid VARCHAR(36),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  CONSTRAINT unique_credential_per_user UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user_id
  ON public.passkey_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_passkey_credentials_webauthn_user_id
  ON public.passkey_credentials(webauthn_user_id);

CREATE TABLE IF NOT EXISTS public.passkey_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  webauthn_user_id TEXT,
  type VARCHAR(20) NOT NULL CHECK (type IN ('registration', 'authentication')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expires_at
  ON public.passkey_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_passkey_challenges_challenge
  ON public.passkey_challenges(challenge);

CREATE TABLE IF NOT EXISTS public.passkey_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,
  identifier_type VARCHAR(10) NOT NULL CHECK (identifier_type IN ('ip', 'email')),
  endpoint VARCHAR(50) NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_rate_limit_window UNIQUE (identifier, identifier_type, endpoint, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
  ON public.passkey_rate_limits(identifier, identifier_type, endpoint, window_start);

CREATE TYPE public.passkey_audit_event AS ENUM (
  'registration_started',
  'registration_completed',
  'registration_failed',
  'authentication_started',
  'authentication_completed',
  'authentication_failed',
  'passkey_removed',
  'passkey_updated',
  'rate_limit_exceeded',
  'challenge_expired',
  'counter_mismatch'
);

CREATE TABLE IF NOT EXISTS public.passkey_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type public.passkey_audit_event NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  credential_id TEXT,
  email TEXT,
  ip_address INET,
  user_agent TEXT,
  origin TEXT,
  metadata JSONB,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.passkey_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON public.passkey_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.passkey_audit_log(created_at);

ALTER TABLE public.passkey_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passkey_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passkey_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passkey_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own passkeys"
  ON public.passkey_credentials FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own passkeys"
  ON public.passkey_credentials FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own audit logs"
  ON public.passkey_audit_log FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.cleanup_expired_passkey_challenges()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.passkey_challenges WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_passkey_rate_limit(
  p_identifier TEXT,
  p_identifier_type VARCHAR(10),
  p_endpoint VARCHAR(50),
  p_max_attempts INTEGER DEFAULT 10,
  p_window_minutes INTEGER DEFAULT 1
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_current_count INTEGER;
BEGIN
  v_window_start := date_trunc('minute', NOW());
  INSERT INTO public.passkey_rate_limits (identifier, identifier_type, endpoint, window_start, attempt_count)
  VALUES (p_identifier, p_identifier_type, p_endpoint, v_window_start, 1)
  ON CONFLICT (identifier, identifier_type, endpoint, window_start)
  DO UPDATE SET attempt_count = public.passkey_rate_limits.attempt_count + 1
  RETURNING attempt_count INTO v_current_count;
  RETURN v_current_count > p_max_attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_passkey_audit_event(
  p_event_type public.passkey_audit_event,
  p_user_id UUID DEFAULT NULL,
  p_credential_id TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_origin TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO public.passkey_audit_log (
    event_type, user_id, credential_id, email, ip_address, user_agent, origin, metadata, error_code, error_message
  ) VALUES (
    p_event_type, p_user_id, p_credential_id, p_email, p_ip_address, p_user_agent, p_origin, p_metadata, p_error_code, p_error_message
  ) RETURNING id INTO v_log_id;
  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_passkey_challenges() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_passkey_rate_limit(TEXT, VARCHAR, VARCHAR, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_passkey_audit_event(public.passkey_audit_event, UUID, TEXT, TEXT, INET, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_passkey_challenges() TO service_role;
GRANT EXECUTE ON FUNCTION public.check_passkey_rate_limit(TEXT, VARCHAR, VARCHAR, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_passkey_audit_event(public.passkey_audit_event, UUID, TEXT, TEXT, INET, TEXT, TEXT, JSONB, TEXT, TEXT) TO service_role;
