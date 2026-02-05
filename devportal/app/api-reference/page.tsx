/* eslint-disable react/no-unknown-property */
'use client';

import { ApiReferenceReact } from '@scalar/api-reference-react';
import { useTheme } from 'next-themes';
import { useMemo } from 'react';

const specUrl = process.env.NEXT_PUBLIC_OPENAPI_URL || '/flowscan-api/openapi.yaml';
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || '/flowscan-api';

export default function ApiReferencePage() {
  const { resolvedTheme } = useTheme();
  const scalarTheme = useMemo(
    () => (resolvedTheme === 'dark' ? 'deepSpace' : 'default'),
    [resolvedTheme],
  );

  return (
    <div className="min-h-screen bg-white">
      <ApiReferenceReact
        configuration={{
          url: specUrl,
          baseServerURL: apiBase,
          // Override servers so "Try It" and server selection target the docs proxy.
          servers: [{ url: apiBase, description: 'FlowScan API (proxy)' }],
          theme: scalarTheme,
          darkMode: resolvedTheme === 'dark',
          showSidebar: true,
          hideDownloadButton: false,
          hideTestRequestButton: false,
          // We provide our own fonts via Next; Scalar can load its defaults if desired.
          withDefaultFonts: false,
        }}
      />
    </div>
  );
}
