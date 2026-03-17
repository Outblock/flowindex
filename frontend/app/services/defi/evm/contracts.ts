export const ANKR = {
  ankrFlow: '0x1b97100eA1D7126C4d60027e231EA4CB25314bdb' as const,
  ratioFeed: '0x32015e1Bd4bAAC9b959b100B0ca253BD131dE38F' as const,
}

export const MORE_MARKETS = {
  pool: '0xbC92aaC2DBBF42215248B5688eB3D3d2b32F2c8d' as const,
  poolDataProvider: '0x79e71e3c0EDF2B88b0aB38E9A1eF0F6a230e56bf' as const,
  assets: [
    { address: '0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e' as const, symbol: 'WFLOW', decimals: 18 },
    { address: '0x1b97100eA1D7126C4d60027e231EA4CB25314bdb' as const, symbol: 'ankrFLOW', decimals: 18 },
    { address: '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590' as const, symbol: 'WETH', decimals: 18 },
  ] as const,
}

export const KITTYPUNCH = {
  v2Factory: '0x29372c22459a4e373851798bFd6808e71EA34A71' as const,
  v3Factory: '0xf331959366032a634c7cAcF5852fE01ffdB84Af0' as const,
  v3NftManager: '0xDfA7829Eb75B66790b6E9758DF48E518c69ee34a' as const,
  v2Pairs: [] as readonly { address: `0x${string}`; token0Symbol: string; token1Symbol: string; token0Decimals: number; token1Decimals: number }[],
}

export const FLOWSWAP = {
  v2Factory: '0x681D1bFE03522e0727730Ba02a05CD3C0a08fa30' as const,
  v3NftManager: '0xf7F20a346E3097C7d38afDDA65c7C802950195C7' as const,
  v2Pairs: [] as readonly { address: `0x${string}`; token0Symbol: string; token1Symbol: string; token0Decimals: number; token1Decimals: number }[],
}

export const WFLOW = '0xd3bF53DAC106A0290B0483EcBC89d40FcC961f3e' as const
