import { createAPIPage } from 'fumadocs-openapi/ui';
import { openapi } from '@/lib/openapi';

const APIPage = createAPIPage(openapi, {
  client: {
    storageKeyPrefix: 'flowscan-openapi-',
    playground: {
      requestTimeout: 30,
    },
  },
});

export const dynamic = 'force-dynamic';

export default function ApiExplorerPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)]">
      <APIPage document={openapi.getSchema('flowscan')} showTitle showDescription />
    </div>
  );
}

