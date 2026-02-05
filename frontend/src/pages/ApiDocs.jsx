import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';

function ApiDocs({ specUrl }) {
  return (
    <div className="min-h-screen bg-black text-white">
      <ApiReferenceReact
        configuration={{
          url: specUrl,
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
