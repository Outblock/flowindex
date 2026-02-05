import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { BookOpen, Code2, FlaskConical } from 'lucide-react';

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
      {
        text: 'API (Scalar)',
        url: '/api-reference',
        icon: <Code2 className="size-4" />,
      },
      {
        text: 'API (Fumadocs)',
        url: '/api-explorer',
        icon: <FlaskConical className="size-4" />,
      },
    ],
  };
}
