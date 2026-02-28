// Category colors
export const COLORS = {
  trigger: '#00ef8b',    // green
  condition: '#f59e0b',  // amber
  destination: '#3b82f6', // blue
} as const

// Preset tokens (reused from subscriptions)
export const FT_TOKENS = [
  { value: '', label: 'Any Token' },
  { value: 'A.1654653399040a61.FlowToken', label: 'FLOW' },
  { value: 'A.b19436aae4d94622.FiatToken', label: 'USDC' },
  { value: 'A.cfdd90d4a00f7b5b.TeleportedTetherToken', label: 'USDT' },
  { value: 'A.d6f80565193ad727.stFlowToken', label: 'stFLOW' },
  { value: 'A.231cc0dbbcffc4b7.ceWBTC', label: 'BTC (Celer)' },
  { value: 'A.231cc0dbbcffc4b7.ceWETH', label: 'ETH (Celer)' },
  { value: 'A.3c1c4b041ad18279.PYUSD', label: 'PYUSD' },
]

export const NFT_COLLECTIONS = [
  { value: '', label: 'Any Collection' },
  { value: 'A.0b2a3299cc857e29.TopShot', label: 'NBA Top Shot' },
  { value: 'A.e4cf4bdc1751c65d.AllDay', label: 'NFL All Day' },
  { value: 'A.329feb3ab062d289.UFC_NFT', label: 'UFC Strike' },
  { value: 'A.87ca73a41bb50ad5.Golazos', label: 'LaLiga Golazos' },
  { value: 'A.2d4c3caffbeab845.FLOAT', label: 'FLOAT' },
]
