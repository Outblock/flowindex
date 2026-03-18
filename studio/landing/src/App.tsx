import { useState, useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { AuthProvider, LoginModal, useAuth } from '@flowindex/auth-ui'
import WorkflowCanvas, { workflowPresets } from './components/WorkflowCanvas'

function LogoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20">
      <path
        d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

const authConfig = {
  gotrueUrl: import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/auth/v1`
    : 'https://run.flowindex.io/auth/v1',
  passkeyAuthUrl: import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/passkey-auth`
    : 'https://run.flowindex.io/functions/v1/passkey-auth',
  // Use flowindex.io's existing OAuth callback (already registered with GitHub/Google)
  // It will redirect back to studio.flowindex.io via the ?redirect= parameter
  callbackPath: 'https://flowindex.io/developer/callback',
}

// Workshop URL — Sim Studio on the same domain
const WORKSHOP_URL = import.meta.env.VITE_WORKSHOP_URL || '/w'

function AuthRedirect() {
  const { user, accessToken, loading, handleCallback } = useAuth()

  // Handle OAuth callback tokens in URL hash (e.g. returning from flowindex.io/developer/callback)
  useEffect(() => {
    const hash = window.location.hash
    if (hash && hash.includes('access_token=')) {
      handleCallback(hash)
      // Clean URL
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [handleCallback])

  // Once authenticated, set fi_auth cookie and redirect to workshop
  useEffect(() => {
    if (loading || !user || !accessToken) return

    // Set fi_auth cookie so Sim Studio recognizes the session
    const domain = window.location.hostname.endsWith('.flowindex.io')
      ? '.flowindex.io'
      : window.location.hostname
    document.cookie = `fi_auth=${accessToken}; path=/; domain=${domain}; max-age=3600; SameSite=Lax`

    // Redirect to workshop
    window.location.href = WORKSHOP_URL
  }, [user, accessToken, loading])

  return null
}

export default function App() {
  const [showLogin, setShowLogin] = useState(false)
  const [activePreset, setActivePreset] = useState(0)

  return (
    <AuthProvider config={authConfig}>
      <AuthRedirect />
      {/* Nav */}
      <nav>
        <div className="container nav-inner">
          <div className="logo">
            <LogoIcon />
            FlowIndex Studio
          </div>
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#templates">Templates</a>
            <a href="#">Docs</a>
          </div>
          <div>
            <button className="btn-primary" onClick={() => setShowLogin(true)}>
              Sign In
            </button>
          </div>
        </div>
      </nav>

      <main>
        {/* Hero */}
        <section className="hero container">
          <div className="hero-badge">
            <span className="mono">v0.1 Alpha</span> Now supporting Cadence — Flow-EVM coming soon
          </div>
          <h1>
            Orchestrate <span className="hero-highlight">Flow</span> <br />
            with Multi-Agent Workflows
          </h1>
          <p>
            Visually design, deploy, and manage complex blockchain interactions on Flow.
            Connect AI agents, smart contracts, and off-chain APIs in a unified canvas.
          </p>
          <div className="hero-actions">
            <button className="btn-primary" onClick={() => setShowLogin(true)}>
              Start Building Free
            </button>
            <a href="https://github.com/Outblock/FlowIndex-monorepo/tree/main/sim-workflow" target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              Open Source
            </a>
          </div>
        </section>

        {/* App Window Preview */}
        <div className="app-window-wrapper">
          <div className="app-window app-window-large">
            <div className="app-header">
              <div className="app-breadcrumbs">
                <span className="muted">Projects /</span>
                {workflowPresets[activePreset].name}
                <span className="app-header-tag">Draft</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn-secondary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.75rem' }}>
                  Deploy
                </button>
                <button className="btn-primary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.75rem' }}>
                  Run Test
                </button>
              </div>
            </div>

            <div className="app-body app-body-two-col">
              {/* Workflow Switcher Sidebar */}
              <div className="app-sidebar">
                <div className="sidebar-header">
                  <span className="label-caps" style={{ color: 'var(--text-high)' }}>Example Workflows</span>
                </div>
                <div className="workflow-list">
                  {workflowPresets.map((preset, i) => (
                    <div
                      key={preset.id}
                      className={`workflow-item${i === activePreset ? ' active' : ''}`}
                      onClick={() => setActivePreset(i)}
                    >
                      <div className="workflow-item-header">
                        <span className="workflow-item-name">{preset.name}</span>
                        <span className={`node-tag${preset.tag === 'DeFi' || preset.tag === 'Security' ? ' purple' : ''}`}>{preset.tag}</span>
                      </div>
                      <span className="workflow-item-desc">{preset.description}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Canvas */}
              <ReactFlowProvider>
                <WorkflowCanvas preset={workflowPresets[activePreset]} />
              </ReactFlowProvider>
            </div>
          </div>
        </div>

        {/* Features */}
        <section id="features" className="container section-padding">
          <div className="text-center" style={{ marginBottom: '2rem' }}>
            <span className="label-caps">Platform Capabilities</span>
            <h2 style={{ fontSize: '2.5rem', marginTop: '0.5rem' }}>
              Everything you need to automate Web3.
            </h2>
          </div>

          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">
                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="1.5" fill="none">
                  <path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3>Visual Blockchain Builder</h3>
              <p>
                Design complex Flow and Flow-EVM interactions using a drag-and-drop
                interface. No deep smart contract knowledge required to string together
                transactions.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="1.5" fill="none">
                  <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h3>Multi-Agent Orchestration</h3>
              <p>
                Deploy specialized AI agents as nodes in your workflow. Have them read
                chain data, analyze trends, and dynamically construct transaction
                payloads.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="1.5" fill="none">
                  <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <h3>Seamless Wallet Integration</h3>
              <p>
                Built-in FCL (Flow Client Library) support. Trigger workflows securely
                based on user wallet signatures and transaction approvals.
              </p>
            </div>
          </div>
        </section>

        {/* Templates */}
        <section
          id="templates"
          className="container section-padding"
          style={{ borderTop: '1px solid var(--border-color)' }}
        >
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '2rem' }}>Start from a Template</h2>
            <p style={{ color: 'var(--text-med)' }}>
              Pre-built workflows to accelerate your dApp development.
            </p>
          </div>

          <div className="templates-scroll">
            <div className="template-card">
              <div className="template-viz">
                <div className="mini-node" />
                <div className="mini-line" />
                <div className="mini-node" style={{ borderColor: 'var(--accent-primary)' }} />
                <div className="mini-line" />
                <div className="mini-node" />
              </div>
              <h4>NFT Minting Service</h4>
              <p className="label-caps" style={{ marginTop: '0.5rem' }}>
                Webhook &rarr; Contract Call &rarr; Email
              </p>
            </div>

            <div className="template-card">
              <div className="template-viz">
                <div className="mini-node" />
                <div className="mini-line" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div className="mini-node" />
                  <div className="mini-node" />
                </div>
              </div>
              <h4>EVM Arbitrage Bot</h4>
              <p className="label-caps" style={{ marginTop: '0.5rem' }}>
                Chain Event &rarr; Agent Logic &rarr; Swap
              </p>
            </div>

            <div className="template-card">
              <div className="template-viz">
                <div className="mini-node" style={{ borderRadius: '50%' }} />
                <div className="mini-line" />
                <div className="mini-node" />
              </div>
              <h4>Daily Token Airdrop</h4>
              <p className="label-caps" style={{ marginTop: '0.5rem' }}>
                CRON &rarr; Query DB &rarr; Batch Transfer
              </p>
            </div>

            <div className="template-card">
              <div className="template-viz">
                <div className="mini-node" />
                <div className="mini-line" style={{ background: 'var(--accent-primary)' }} />
                <div className="mini-node" style={{ borderColor: 'var(--accent-primary)' }} />
              </div>
              <h4>Cross-Chain Bridge Monitor</h4>
              <p className="label-caps" style={{ marginTop: '0.5rem' }}>
                Listener &rarr; API &rarr; Alert
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="container section-padding text-center">
          <h2 style={{ fontSize: '2.5rem', marginBottom: '1.5rem' }}>
            Ready to build on Flow?
          </h2>
          <button
            className="btn-primary"
            style={{ fontSize: '1rem', padding: '0.8rem 1.5rem' }}
            onClick={() => setShowLogin(true)}
          >
            Launch Editor
          </button>
        </section>
      </main>

      {/* Footer */}
      <footer>
        <div className="container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="logo">
              <LogoIcon />
              FlowIndex Studio
            </div>
            <div style={{ display: 'flex', gap: '1.5rem' }}>
              <a href="#">Twitter</a>
              <a href="#">Discord</a>
              <a href="#">GitHub</a>
            </div>
          </div>
          <p style={{ marginTop: '2rem', color: 'var(--text-low)' }}>
            &copy; 2024 FlowIndex Studio. Built for the Flow Ecosystem.
          </p>
        </div>
      </footer>

      {/* Login Modal */}
      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />
    </AuthProvider>
  )
}
