import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { BookOpen, Play, Bot, Wallet, Package } from 'lucide-react';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'Outblock',
      url: '/',
    },
    githubUrl: 'https://github.com/Outblock',
    links: [
      {
        text: 'FlowIndex',
        url: '/docs/flowindex',
        icon: <BookOpen className="size-4" />,
      },
      {
        text: 'Run',
        url: '/docs/run',
        icon: <Play className="size-4" />,
      },
      {
        text: 'AI',
        url: '/docs/ai',
        icon: <Bot className="size-4" />,
      },
      {
        text: 'Wallet',
        url: '/docs/wallet',
        icon: <Wallet className="size-4" />,
      },
      {
        text: 'Packages',
        url: '/docs/packages',
        icon: <Package className="size-4" />,
      },
    ],
  };
}
