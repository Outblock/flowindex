-- Fix Supabase Studio linter security warnings

-- 1. Move pgcrypto extension from public to extensions schema
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pgcrypto SET SCHEMA extensions;

-- 2. Set immutable search_path on all SECURITY DEFINER functions

CREATE OR REPLACE FUNCTION public.cleanup_expired_passkey_challenges()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
SET search_path = ''
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
SET search_path = ''
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

-- handle_new_user is from GoTrue default setup; fix search_path if it exists
DO $$ BEGIN
  ALTER FUNCTION public.handle_new_user() SET search_path = '';
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
