/**
 * OG image templates for Satori.
 *
 * Satori uses a subset of CSS (flexbox only, no grid) and renders JSX to SVG.
 * These are plain JSX functions (not React components) — they return the
 * virtual DOM tree that Satori consumes.
 */

// Satori needs explicit `display: 'flex'` on every container div.
// Colors match the dark theme of the site.

const COLORS = {
  bg: '#000000',
  bgCard: '#0a0a0a',
  green: '#39FF14',
  greenDim: 'rgba(57, 255, 20, 0.15)',
  white: '#ffffff',
  gray: '#a1a1aa',
  grayDim: '#52525b',
  border: 'rgba(255, 255, 255, 0.1)',
};

function Container({ children }: { children: any }) {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: COLORS.bg,
        color: COLORS.white,
        fontFamily: 'Inter',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle grid pattern */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      {/* Green accent line at top */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          display: 'flex',
          background: `linear-gradient(90deg, ${COLORS.green}, transparent)`,
        }}
      />
      {/* Content */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          padding: '48px 56px',
          position: 'relative',
        }}
      >
        {children}
      </div>
      {/* Footer branding */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 56px',
          borderTop: `1px solid ${COLORS.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              background: COLORS.green,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 700,
              color: '#000',
            }}
          >
            F
          </div>
          <span style={{ fontSize: 16, color: COLORS.gray, letterSpacing: '0.05em' }}>
            flowindex.io
          </span>
        </div>
        <span style={{ fontSize: 14, color: COLORS.grayDim }}>Flow Blockchain Explorer</span>
      </div>
    </div>
  );
}

function Label({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        fontSize: 13,
        color: COLORS.green,
        textTransform: 'uppercase',
        letterSpacing: '0.2em',
        fontWeight: 600,
        marginBottom: 16,
      }}
    >
      {text}
    </div>
  );
}

function Title({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        fontSize: text.length > 40 ? 36 : 52,
        fontWeight: 700,
        color: COLORS.white,
        lineHeight: 1.2,
        marginBottom: 16,
      }}
    >
      {text}
    </div>
  );
}

function Subtitle({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        fontSize: 20,
        color: COLORS.gray,
        lineHeight: 1.4,
      }}
    >
      {text}
    </div>
  );
}

function StatRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 32,
        marginTop: 'auto',
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '16px 24px',
            border: `1px solid ${COLORS.border}`,
            borderRadius: 4,
            background: COLORS.bgCard,
          }}
        >
          <span style={{ fontSize: 11, color: COLORS.grayDim, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 6 }}>
            {item.label}
          </span>
          <span style={{ fontSize: 22, fontWeight: 600, color: COLORS.white }}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// --- Public templates ---

export function homeTemplate() {
  return (
    <Container>
      <Label text="Flow Blockchain Explorer" />
      <Title text="FlowIndex" />
      <Subtitle text="Real-time blocks, transactions, accounts, tokens, and NFTs on the Flow network" />
      <StatRow
        items={[
          { label: 'Blocks', value: 'Real-time' },
          { label: 'Transactions', value: 'Indexed' },
          { label: 'Network', value: 'Flow Mainnet' },
        ]}
      />
    </Container>
  );
}

export function blockTemplate(height: string | number, txCount?: number) {
  return (
    <Container>
      <Label text="Block" />
      <Title text={`#${Number(height).toLocaleString()}`} />
      <Subtitle text={`Block at height ${Number(height).toLocaleString()} on the Flow blockchain`} />
      <StatRow
        items={[
          { label: 'Height', value: Number(height).toLocaleString() },
          ...(txCount != null ? [{ label: 'Transactions', value: String(txCount) }] : []),
          { label: 'Network', value: 'Flow Mainnet' },
        ]}
      />
    </Container>
  );
}

export function txTemplate(txId: string, status?: string) {
  const shortId = txId.length > 16 ? `${txId.slice(0, 10)}...${txId.slice(-8)}` : txId;
  return (
    <Container>
      <Label text="Transaction" />
      <Title text={shortId} />
      <Subtitle text="Transaction on the Flow blockchain" />
      <StatRow
        items={[
          { label: 'Status', value: status || 'Sealed' },
          { label: 'Network', value: 'Flow Mainnet' },
        ]}
      />
    </Container>
  );
}

export function accountTemplate(address: string) {
  return (
    <Container>
      <Label text="Account" />
      <Title text={address} />
      <Subtitle text="Flow account activity, tokens, NFTs, and keys" />
      <StatRow
        items={[
          { label: 'Address', value: address.length > 18 ? `${address.slice(0, 10)}...${address.slice(-6)}` : address },
          { label: 'Network', value: 'Flow Mainnet' },
        ]}
      />
    </Container>
  );
}

export function tokenTemplate(tokenName: string) {
  return (
    <Container>
      <Label text="Token" />
      <Title text={tokenName} />
      <Subtitle text="Fungible token on the Flow blockchain" />
      <StatRow
        items={[
          { label: 'Type', value: 'Fungible Token' },
          { label: 'Network', value: 'Flow Mainnet' },
        ]}
      />
    </Container>
  );
}

export function nftTemplate(collectionName: string) {
  return (
    <Container>
      <Label text="NFT Collection" />
      <Title text={collectionName} />
      <Subtitle text="Non-fungible token collection on the Flow blockchain" />
      <StatRow
        items={[
          { label: 'Type', value: 'NFT Collection' },
          { label: 'Network', value: 'Flow Mainnet' },
        ]}
      />
    </Container>
  );
}
