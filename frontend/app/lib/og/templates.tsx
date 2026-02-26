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
  green: '#6DEB90',
  greenDim: 'rgba(109, 235, 144, 0.15)',
  white: '#ffffff',
  gray: '#a1a1aa',
  grayDim: '#52525b',
  border: 'rgba(255, 255, 255, 0.1)',
};

// FlowIndex logo as inline SVG data URI (the geometric "F" shape)
const LOGO_SVG = `data:image/svg+xml,${encodeURIComponent('<svg width="50" height="58" viewBox="0 0 50 58" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0.0347046 14.3083C0.401109 14.0493 1.18916 13.6236 1.60619 13.3848L4.61003 11.6757L12.371 7.23582L21.0467 2.24893C21.9736 1.7182 24.1233 0.382086 25.03 0C26.002 0.515443 27.1584 1.2219 28.1262 1.77998L33.8156 5.0536L49.5798 14.0753C49.7349 14.1663 49.8688 14.2168 49.9415 14.3715C50.0558 17.0017 49.9782 43.7661 49.915 43.9121L49.7392 44.0554C49.6 44.0903 48.2827 44.8558 48.0601 44.9817L43.696 47.442L32.4691 53.7734C30.0427 55.1472 27.4192 56.6939 24.9822 58C24.2486 57.6038 23.4758 57.1314 22.7401 56.7183L14.6434 52.133L5.31225 46.885C3.59336 45.9164 1.74116 44.9129 0.0549446 43.9089C-0.0284499 42.9673 0.0202581 41.31 0.0209486 40.3124L0.0254096 33.6946C0.0284373 27.2607 -0.039235 20.7325 0.0347046 14.3083ZM26.0243 28.5805C25.9595 33.9681 26.019 39.5007 26.0228 44.8928L26.0185 50.6725C26.0127 52.0526 25.9834 53.657 26.0413 55.0245C26.5587 54.7679 27.0835 54.4791 27.5817 54.1871C28.8215 53.4602 30.1197 52.7869 31.3441 52.0389C31.3584 50.0081 31.3579 47.9779 31.3435 45.9471C31.3441 44.084 31.3063 42.0157 31.3674 40.1682C31.8832 39.7948 33.4279 38.9806 34.0525 38.6231C36.1948 37.4065 38.3444 36.2031 40.5015 35.0129L40.4925 29.0089C38.7364 29.9742 36.9857 30.949 35.2402 31.9332C33.9776 32.6408 32.6099 33.374 31.3765 34.1175C31.36 33.4822 31.3414 32.3516 31.3897 31.7184C33.2733 30.6199 35.3582 29.5043 37.2789 28.4295L47.9013 22.49C47.8997 20.9375 47.8997 19.3854 47.9087 17.8329C47.9103 17.5835 47.9518 16.8253 47.8376 16.6541L47.7579 16.6369L32.3602 25.1022C30.2546 26.2729 28.1427 27.4323 26.0243 28.5805ZM3.27062 14.8552C5.1104 15.966 6.99979 16.8558 8.78984 17.9014C10.3993 17.0106 24.7522 8.87292 25.0746 8.87837C30.4825 11.8244 35.825 14.9364 41.2191 17.8971C42.2926 17.2953 43.3715 16.7019 44.455 16.1171C44.9304 15.8623 46.3503 15.1248 46.7237 14.8204C42.0717 12.1878 37.4334 9.53072 32.8096 6.84913L27.8277 3.99849C27.3369 3.71707 25.2175 2.41608 24.8855 2.40984L10.301 10.7929L5.67398 13.4448C5.04135 13.807 3.83186 14.4492 3.27062 14.8552ZM47.7483 24.9334C46.0735 25.952 44.1932 26.8438 42.5434 27.8415C42.5295 29.6764 42.5274 31.5113 42.537 33.3462C42.538 34.2268 42.5662 35.3037 42.5184 36.168C40.501 37.4288 38.2605 38.5426 36.1979 39.7466C35.3661 40.2319 34.1752 40.8308 33.4087 41.3856C33.3599 44.3432 33.3593 47.7805 33.4082 50.7317L33.4709 50.7958L33.6355 50.7714C37.2305 48.6708 40.9424 46.703 44.5363 44.5971C45.5944 43.9771 46.8772 43.326 47.8944 42.6991L47.9002 29.5545C47.9013 28.9715 47.9555 25.1846 47.8344 24.9692L47.7483 24.9334ZM39.0339 19.0605C37.9099 18.3919 36.7381 17.769 35.5956 17.1267L30.159 14.0644C28.5469 13.167 26.9305 12.2384 25.3158 11.3421C25.1591 11.2549 25.0539 11.2249 24.8749 11.2315C21.6469 13.0957 18.309 14.9158 15.054 16.7486L12.4613 18.2021C12.0837 18.4122 11.3028 18.8216 10.9698 19.0561C12.7774 20.1812 15.2144 21.4263 17.1118 22.4868L22.2264 25.3194C22.6163 25.5334 24.7862 26.7761 25.0709 26.7938L34.9741 21.309C36.1273 20.6652 38.005 19.7444 39.0339 19.0605Z" fill="#6DEB90"/></svg>')}`;

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
      {/* Large watermark logo in top-right */}
      <div
        style={{
          position: 'absolute',
          top: 40,
          right: 40,
          display: 'flex',
          opacity: 0.06,
        }}
      >
        <img src={LOGO_SVG} width={220} height={256} />
      </div>
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
          <img src={LOGO_SVG} width={22} height={26} />
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
