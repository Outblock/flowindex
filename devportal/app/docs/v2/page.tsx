'use client';

import dynamic from 'next/dynamic';
import '@scalar/api-reference-react/style.css';

const ApiReferenceReact = dynamic(
  () => import('@scalar/api-reference-react').then((m) => m.ApiReferenceReact),
  { ssr: false }
);

export default function ApiReferenceV2() {
  return (
    <div className="mx-auto w-full max-w-6xl py-8">
      <ApiReferenceReact
        configuration={{
          url: '/openapi-v2.json',
        }}
      />
    </div>
  );
}
