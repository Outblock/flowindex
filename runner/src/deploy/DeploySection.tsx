import { useState } from 'react';
import { Github, Settings, Loader2, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useGitHub } from '../github/useGitHub';
import DeployPanel from '../components/DeployPanel';
import DeploySettings from '../components/DeploySettings';

interface DeploySectionProps {
  projectId: string;
}

export default function DeploySection({ projectId }: DeploySectionProps) {
  const github = useGitHub(projectId);
  const [showSettings, setShowSettings] = useState(false);

  if (github.loading) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!github.connection) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-6 text-center">
        <Github className="w-5 h-5 text-zinc-600 mx-auto mb-2" />
        <h3 className="text-xs font-medium text-zinc-400">CD Pipeline</h3>
        <p className="mt-1 text-[11px] text-zinc-500">
          Connect a GitHub repository to enable continuous deployment.
        </p>
        <Link
          to="/editor"
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Connect in Editor
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Github className="w-4 h-4 text-zinc-400" />
          <h3 className="text-xs font-medium text-zinc-300">CD Pipeline</h3>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors rounded hover:bg-zinc-800"
          title="Deploy settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      <DeployPanel
        connection={github.connection}
        environments={github.environments}
        deployments={github.deployments}
        onPromote={github.promote}
        onDispatch={github.dispatchWorkflow}
        onRefresh={() => { github.fetchDeployments(); github.fetchEnvironments(); }}
        onOpenSettings={() => setShowSettings(true)}
      />

      {showSettings && (
        <DeploySettings
          connection={github.connection}
          environments={github.environments}
          onUpsertEnv={github.upsertEnvironment}
          onDeleteEnv={github.deleteEnvironment}
          onConfigureSecrets={github.configureSecrets}
          onSetupWorkflow={github.setupWorkflow}
          onDisconnect={github.disconnect}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
