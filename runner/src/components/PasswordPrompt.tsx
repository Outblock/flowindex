import { useState } from 'react';

interface PasswordPromptProps {
  keyLabel: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export function PasswordPrompt({ keyLabel, onSubmit, onCancel }: PasswordPromptProps) {
  const [password, setPassword] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 w-80">
        <h3 className="text-sm font-medium mb-3">Unlock Key: {keyLabel}</h3>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && password && onSubmit(password)}
          placeholder="Enter password"
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm mb-4"
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1 text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button onClick={() => password && onSubmit(password)} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm">Unlock</button>
        </div>
      </div>
    </div>
  );
}
