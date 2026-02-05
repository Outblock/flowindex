import { DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { createAPIPage, type OperationItem, type WebhookItem } from 'fumadocs-openapi/ui';
import { openapi } from '@/lib/openapi';

const APIPage = createAPIPage(openapi, {
  client: {
    storageKeyPrefix: 'flowscan-openapi-',
    playground: {
      requestTimeout: 30,
    },
  },
});

const methodKeys: OperationItem['method'][] = ['get', 'post', 'patch', 'delete', 'head', 'put'];
const methodOrder = new Map(methodKeys.map((method, index) => [method, index]));

function collectOperations(document: any) {
  const operations: OperationItem[] = [];
  const webhooks: WebhookItem[] = [];
  const paths = document?.dereferenced?.paths ?? {};
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem) continue;
    for (const method of methodKeys) {
      const op = (pathItem as Record<string, unknown>)[method];
      if (!op) continue;
      operations.push({ path, method });
    }
  }

  const hooks = document?.dereferenced?.webhooks ?? {};
  for (const [name, hook] of Object.entries(hooks)) {
    if (!hook) continue;
    for (const method of methodKeys) {
      const op = (hook as Record<string, unknown>)[method];
      if (!op) continue;
      webhooks.push({ name, method });
    }
  }

  operations.sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    return (methodOrder.get(a.method) ?? 0) - (methodOrder.get(b.method) ?? 0);
  });
  webhooks.sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    return (methodOrder.get(a.method) ?? 0) - (methodOrder.get(b.method) ?? 0);
  });

  return { operations, webhooks };
}

export default async function ApiReferenceIndexPage() {
  const document = await openapi.getSchema('flowscan');
  const { operations, webhooks } = collectOperations(document);

  return (
    <DocsPage toc={[]} full className="max-w-[1400px]">
      <DocsTitle>API Reference</DocsTitle>
      <DocsDescription>
        Interactive reference for the FlowScan REST API. Use the sidebar to jump by tag, or
        browse everything below.
      </DocsDescription>
      <div className="not-prose">
        <APIPage document={document} operations={operations} webhooks={webhooks} showTitle showDescription />
      </div>
    </DocsPage>
  );
}
