-- Add EVM smart wallet address to passkey credentials
ALTER TABLE public.passkey_credentials
  ADD COLUMN IF NOT EXISTS evm_address TEXT;

CREATE INDEX IF NOT EXISTS idx_passkey_credentials_evm_address
  ON public.passkey_credentials(evm_address);
