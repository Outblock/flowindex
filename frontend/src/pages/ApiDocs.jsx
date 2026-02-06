import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import { useTheme } from '../contexts/ThemeContext';

function ApiDocs({ specUrl }) {
  const { theme } = useTheme();

  return (
    <div className="min-h-screen bg-white dark:bg-black text-black dark:text-white transition-colors duration-300">
      <ApiReferenceReact
        configuration={{
          url: specUrl,
          darkMode: theme === 'dark',
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
