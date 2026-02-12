import { HardDrive } from 'lucide-react';

interface Props {
    address: string;
}

export function AccountStorageTab({ address }: Props) {
    return (
        <div className="space-y-4">
            <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                Storage
            </h2>

            <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-600">
                <HardDrive className="h-12 w-12 mb-4 opacity-20" />
                <p className="text-xs uppercase tracking-widest mb-2">Storage Browser Not Available</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-500 max-w-md text-center">
                    The storage inspection API has been removed. Use the Flow CLI or Flow Access Node directly to inspect account storage for {address}.
                </p>
            </div>
        </div>
    );
}
