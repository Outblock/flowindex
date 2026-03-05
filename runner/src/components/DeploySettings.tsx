import { useState } from 'react';
import { X, Loader2, Plus, Trash2, Key, ChevronDown, ChevronRight, Rocket, AlertTriangle, Check } from 'lucide-react';
import type { GitHubConnection } from '../github/useGitHub';
import type { DeployEnvironment } from '../github/api';

interface DeploySettingsProps {
  connection: GitHubConnection;
  environments: DeployEnvironment[];
  onUpsertEnv: (env: { name: string; branch: string; network: string; flow_address?: string; is_default?: boolean }) => Promise<void>;
  onDeleteEnv: (envId: string) => Promise<void>;
  onConfigureSecrets: (envName: string, address: string, privateKey: string, keyIndex: string) => Promise<void>;
  onSetupWorkflow: (network: string) => Promise<any>;
  onDisconnect: () => Promise<void>;
  onClose: () => void;
}

export default function DeploySettings({
  connection,
  environments,
  onUpsertEnv,
  onDeleteEnv,
  onConfigureSecrets,
  onSetupWorkflow,
  onDisconnect,
  onClose,
}: DeploySettingsProps) {
  // Add environment form
  const [showAddForm, setShowAddForm] = useState(false);
  const [envName, setEnvName] = useState('');
  const [envBranch, setEnvBranch] = useState('main');
  const [envNetwork, setEnvNetwork] = useState('testnet');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Secrets per environment (keyed by env name)
  const [expandedSecrets, setExpandedSecrets] = useState<string | null>(null);
  const [secretAddress, setSecretAddress] = useState('');
  const [secretPrivateKey, setSecretPrivateKey] = useState('');
  const [secretKeyIndex, setSecretKeyIndex] = useState('0');
  const [savingSecrets, setSavingSecrets] = useState(false);
  const [secretsSuccess, setSecretsSuccess] = useState<string | null>(null);

  // Workflow
  const [settingUpWorkflow, setSettingUpWorkflow] = useState(false);
  const [workflowSuccess, setWorkflowSuccess] = useState(false);

  // Disconnect
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleAddEnv() {
    if (!envName.trim() || !envBranch.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onUpsertEnv({
        name: envName.trim(),
        branch: envBranch.trim(),
        network: envNetwork,
        is_default: environments.length === 0,
      });
      setEnvName('');
      setEnvBranch('main');
      setEnvNetwork('testnet');
      setShowAddForm(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add environment');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEnv(envId: string) {
    setError(null);
    try {
      await onDeleteEnv(envId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete environment');
    }
  }

  function toggleSecrets(envName: string) {
    if (expandedSecrets === envName) {
      setExpandedSecrets(null);
    } else {
      setExpandedSecrets(envName);
      setSecretAddress('');
      setSecretPrivateKey('');
      setSecretKeyIndex('0');
      setSecretsSuccess(null);
    }
  }

  async function handleSaveSecrets(envName: string) {
    if (!secretAddress.trim() || !secretPrivateKey.trim()) return;
    setSavingSecrets(true);
    setError(null);
    try {
      await onConfigureSecrets(envName, secretAddress.trim(), secretPrivateKey.trim(), secretKeyIndex.trim() || '0');
      setSecretsSuccess(envName);
      setTimeout(() => setSecretsSuccess(null), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to configure secrets');
    } finally {
      setSavingSecrets(false);
    }
  }

  async function handleSetupWorkflow() {
    setSettingUpWorkflow(true);
    setError(null);
    try {
      const defaultEnv = environments.find(e => e.is_default);
      await onSetupWorkflow(defaultEnv?.network || 'testnet');
      setWorkflowSuccess(true);
      setTimeout(() => setWorkflowSuccess(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to setup workflow');
    } finally {
      setSettingUpWorkflow(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await onDisconnect();
    } catch {
      setDisconnecting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0">
          <div className="text-zinc-200 text-sm font-medium">Deploy Settings</div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 p-4 space-y-6">
          {error && (
            <div className="px-3 py-2 bg-red-900/30 border border-red-800 rounded text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Repository info */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Repository</div>
            <div className="text-xs text-zinc-300">
              {connection.repo_owner}/{connection.repo_name}
              <span className="text-zinc-500 ml-2">({connection.branch})</span>
            </div>
          </div>

          {/* Environments section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Environments</div>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded hover:border-zinc-600 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add
              </button>
            </div>

            {/* Add environment form */}
            {showAddForm && (
              <div className="mb-3 p-3 border border-zinc-700 rounded space-y-2">
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">Name</label>
                  <input
                    value={envName}
                    onChange={(e) => setEnvName(e.target.value)}
                    placeholder="e.g. staging, production"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] text-zinc-500 mb-1">Branch</label>
                    <input
                      value={envBranch}
                      onChange={(e) => setEnvBranch(e.target.value)}
                      placeholder="main"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] text-zinc-500 mb-1">Network</label>
                    <select
                      value={envNetwork}
                      onChange={(e) => setEnvNetwork(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="testnet">Testnet</option>
                      <option value="mainnet">Mainnet</option>
                    </select>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setShowAddForm(false)}
                    className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddEnv}
                    disabled={saving || !envName.trim() || !envBranch.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded transition-colors"
                  >
                    {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                    Add Environment
                  </button>
                </div>
              </div>
            )}

            {/* Environment list */}
            {environments.length === 0 ? (
              <div className="text-xs text-zinc-500 py-2">No environments configured yet.</div>
            ) : (
              <div className="space-y-2">
                {environments.map((env) => (
                  <div key={env.id} className="border border-zinc-800 rounded">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-200 font-medium">{env.name}</span>
                          {env.is_default && (
                            <span className="text-[9px] px-1 py-0.5 bg-blue-900/30 text-blue-400 rounded">default</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] text-zinc-400">{env.branch}</span>
                          <span className="text-[10px] text-zinc-600">→</span>
                          <span className={`text-[10px] ${env.network === 'mainnet' ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {env.network}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {env.secrets_configured ? (
                          <span className="text-[9px] px-1.5 py-0.5 bg-emerald-900/30 text-emerald-400 rounded flex items-center gap-1">
                            <Key className="w-2.5 h-2.5" />
                            secrets
                          </span>
                        ) : (
                          <span className="text-[9px] px-1.5 py-0.5 bg-zinc-800 text-zinc-500 rounded flex items-center gap-1">
                            <Key className="w-2.5 h-2.5" />
                            no secrets
                          </span>
                        )}
                        <button
                          onClick={() => toggleSecrets(env.name)}
                          className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                          title="Configure secrets"
                        >
                          {expandedSecrets === env.name ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => handleDeleteEnv(env.id)}
                          className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
                          title="Delete environment"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Secrets form */}
                    {expandedSecrets === env.name && (
                      <div className="px-3 pb-3 pt-1 border-t border-zinc-800 space-y-2">
                        <div>
                          <label className="block text-[10px] text-zinc-500 mb-1">FLOW_ADDRESS</label>
                          <input
                            value={secretAddress}
                            onChange={(e) => setSecretAddress(e.target.value)}
                            placeholder="0x..."
                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-zinc-500 mb-1">FLOW_PRIVATE_KEY</label>
                          <input
                            type="password"
                            value={secretPrivateKey}
                            onChange={(e) => setSecretPrivateKey(e.target.value)}
                            placeholder="Private key"
                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-zinc-500 mb-1">FLOW_KEY_INDEX</label>
                          <input
                            value={secretKeyIndex}
                            onChange={(e) => setSecretKeyIndex(e.target.value)}
                            placeholder="0"
                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none font-mono"
                          />
                        </div>
                        <div className="flex justify-end pt-1">
                          <button
                            onClick={() => handleSaveSecrets(env.name)}
                            disabled={savingSecrets || !secretAddress.trim() || !secretPrivateKey.trim()}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded transition-colors"
                          >
                            {savingSecrets ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : secretsSuccess === env.name ? (
                              <Check className="w-3 h-3" />
                            ) : (
                              <Key className="w-3 h-3" />
                            )}
                            {secretsSuccess === env.name ? 'Saved' : 'Save Secrets'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Workflow section */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Workflow</div>
            <p className="text-[11px] text-zinc-400 mb-2">
              {connection.workflow_configured
                ? 'GitHub Actions workflow is configured. You can regenerate it to update.'
                : 'Set up a GitHub Actions workflow to enable automatic deployments.'}
            </p>
            <button
              onClick={handleSetupWorkflow}
              disabled={settingUpWorkflow}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-zinc-700 rounded text-zinc-300 hover:text-zinc-100 hover:border-zinc-600 disabled:opacity-50 transition-colors"
            >
              {settingUpWorkflow ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : workflowSuccess ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Rocket className="w-3.5 h-3.5" />
              )}
              {workflowSuccess ? 'Workflow Updated' : connection.workflow_configured ? 'Update Workflow' : 'Setup Workflow'}
            </button>
          </div>

          {/* Danger zone */}
          <div className="border-t border-zinc-700 pt-4">
            <div className="text-[10px] uppercase tracking-wider text-red-400/60 mb-2">Danger Zone</div>
            {!confirmDisconnect ? (
              <button
                onClick={() => setConfirmDisconnect(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 border border-red-900/50 rounded hover:border-red-700 hover:bg-red-900/20 transition-colors"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Disconnect GitHub
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">Are you sure?</span>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded transition-colors"
                >
                  {disconnecting && <Loader2 className="w-3 h-3 animate-spin" />}
                  Disconnect
                </button>
                <button
                  onClick={() => setConfirmDisconnect(false)}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
