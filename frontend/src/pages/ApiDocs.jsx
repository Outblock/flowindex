import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';

const specUrl = '/api/openapi.yaml';
const apiBase = '/api';

function ApiDocs() {
  return (
    <div className="min-h-screen bg-black text-white">
      <ApiReferenceReact
        configuration={{
          url: specUrl,
          baseServerURL: apiBase,
          servers: [{ url: apiBase, description: 'FlowScan API' }],
          theme: 'deepSpace',
          darkMode: true,
          forceDarkModeState: 'dark',
          hideDarkModeToggle: true,
          showSidebar: true,
          hideDownloadButton: false,
          hideTestRequestButton: false,
          withDefaultFonts: false,
        }}
      />
    </div>
  );
}

export default ApiDocs;
