import { Users, Lock, Server } from 'lucide-react';

export function NetworkStats({ totalStaked, activeNodes }) {
    if (!totalStaked) {
        return (
            <div className="grid grid-cols-2 gap-4 h-full">
                {[1, 2].map((i) => (
                    <div key={i} className="bg-nothing-dark border border-white/10 p-4 flex flex-col justify-between animate-pulse">
                        <div className="p-1.5 w-8 h-8 bg-white/5 rounded-sm mb-4"></div>
                        <div className="space-y-2">
                            <div className="h-3 w-16 bg-white/5 rounded-sm"></div>
                            <div className="h-6 w-24 bg-white/5 rounded-sm"></div>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    const stats = [
        {
            label: "Total Staked",
            value: `${(totalStaked / 1000000).toFixed(0)}M FLOW`,
            icon: Lock,
            color: "text-purple-400",
            bg: "bg-purple-500/10",
            border: "border-purple-500/20"
        },
        {
            label: "Active Nodes",
            value: activeNodes,
            icon: Server,
            color: "text-orange-400",
            bg: "bg-orange-500/10",
            border: "border-orange-500/20"
        }
    ];

    return (
        <div className="grid grid-cols-2 gap-4 h-full">
            {stats.map((stat, idx) => (
                <div key={idx} className={`bg-nothing-dark border border-white/10 p-4 flex flex-col justify-between hover:border-white/30 transition-all duration-300 relative overflow-hidden group`}>
                    <div className="absolute top-0 right-0 w-16 h-16 bg-white/5 blur-2xl rounded-full group-hover:bg-white/10 transition-colors" />

                    <div className="flex justify-between items-start mb-2">
                        <div className={`p-1.5 rounded-sm ${stat.bg} ${stat.border} border`}>
                            <stat.icon className={`w-4 h-4 ${stat.color}`} />
                        </div>
                    </div>

                    <div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">{stat.label}</p>
                        <p className="text-xl font-mono font-bold text-white">{stat.value}</p>
                    </div>
                </div>
            ))}
        </div>
    );
}
