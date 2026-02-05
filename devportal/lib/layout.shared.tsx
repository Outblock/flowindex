import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { BookOpen } from 'lucide-react';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'FlowScan',
      url: '/',
    },
    githubUrl: 'https://github.com/zenabot27/flowscan-clone',
    links: [
      {
        text: 'Docs',
        url: '/docs',
        icon: <BookOpen className="size-4" />,
      },
    ],
  };
}
