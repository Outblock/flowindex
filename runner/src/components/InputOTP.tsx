import { OTPInput, OTPInputContext } from 'input-otp';
import { useContext } from 'react';

function InputOTP({
  maxLength,
  value,
  onChange,
  disabled,
  autoFocus,
  children,
}: {
  maxLength: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  children: React.ReactNode;
}) {
  return (
    <OTPInput
      maxLength={maxLength}
      value={value}
      onChange={onChange}
      disabled={disabled}
      autoFocus={autoFocus}
      containerClassName="flex items-center gap-1"
      render={({ slots }) => <>{children}</>}
    />
  );
}

function InputOTPGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}

function InputOTPSlot({ index, className }: { index: number; className?: string }) {
  const ctx = useContext(OTPInputContext);
  const slot = ctx.slots[index];
  if (!slot) return null;

  return (
    <div
      className={`relative flex items-center justify-center border text-center transition-all ${
        slot.isActive
          ? 'border-emerald-500 ring-1 ring-emerald-500/30'
          : 'border-zinc-700'
      } ${className || 'h-12 w-11 text-lg font-bold font-mono bg-zinc-950'}`}
    >
      {slot.char ?? ''}
      {slot.hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px bg-emerald-400 animate-caret-blink" />
        </div>
      )}
    </div>
  );
}

export { InputOTP, InputOTPGroup, InputOTPSlot };
