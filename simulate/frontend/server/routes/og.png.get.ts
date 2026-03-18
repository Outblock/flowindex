import { defineEventHandler, setResponseHeaders, createError } from 'h3'
import satori from 'satori'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

let wasmInitialized = false

async function initResvg() {
  if (wasmInitialized) return
  const wasmPath = join(
    process.cwd(),
    'node_modules',
    '@resvg',
    'resvg-wasm',
    'index_bg.wasm'
  )
  const wasmBuffer = await readFile(wasmPath)
  await initWasm(wasmBuffer)
  wasmInitialized = true
}

// Load font from local file
let fontData: Buffer | null = null

async function loadFont(): Promise<Buffer> {
  if (fontData) return fontData
  const fontPath = join(process.cwd(), '.output', 'public', 'fonts', 'Inter-Regular.ttf')
  fontData = await readFile(fontPath)
  return fontData
}

export default defineEventHandler(async (event) => {
  try {
    const [font] = await Promise.all([loadFont(), initResvg()])

    const svg = await satori(
      {
        type: 'div',
        props: {
          style: {
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            background: 'linear-gradient(180deg, #050505 0%, #0a1a0f 50%, #050505 100%)',
            fontFamily: 'Inter',
            position: 'relative',
            overflow: 'hidden',
          },
          children: [
            // Scanline overlay effect
            {
              type: 'div',
              props: {
                style: {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundImage:
                    'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,239,139,0.03) 2px, rgba(0,239,139,0.03) 4px)',
                },
              },
            },
            // Top border accent
            {
              type: 'div',
              props: {
                style: {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: '4px',
                  background: '#00ef8b',
                },
              },
            },
            // Content container
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '24px',
                  padding: '60px',
                },
                children: [
                  // Status badge
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '8px 20px',
                        border: '1px solid rgba(0,239,139,0.3)',
                        borderRadius: '4px',
                        background: 'rgba(0,239,139,0.05)',
                      },
                      children: [
                        {
                          type: 'div',
                          props: {
                            style: {
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: '#00ef8b',
                              boxShadow: '0 0 12px #00ef8b',
                            },
                          },
                        },
                        {
                          type: 'span',
                          props: {
                            style: {
                              color: '#00ef8b',
                              fontSize: '14px',
                              letterSpacing: '4px',
                              fontWeight: 700,
                            },
                            children: 'MAINNET FORK',
                          },
                        },
                      ],
                    },
                  },
                  // Main title
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '8px',
                      },
                      children: [
                        {
                          type: 'span',
                          props: {
                            style: {
                              fontSize: '20px',
                              letterSpacing: '8px',
                              color: 'rgba(255,255,255,0.4)',
                              fontWeight: 700,
                            },
                            children: 'FLOWINDEX',
                          },
                        },
                        {
                          type: 'span',
                          props: {
                            style: {
                              fontSize: '64px',
                              fontWeight: 900,
                              color: 'white',
                              letterSpacing: '2px',
                            },
                            children: 'Simulator',
                          },
                        },
                      ],
                    },
                  },
                  // Tagline
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        gap: '8px',
                        fontSize: '24px',
                        fontWeight: 600,
                      },
                      children: [
                        {
                          type: 'span',
                          props: {
                            style: { color: 'rgba(255,255,255,0.8)' },
                            children: 'See what happens.',
                          },
                        },
                        {
                          type: 'span',
                          props: {
                            style: {
                              color: '#00ef8b',
                            },
                            children: 'Before it happens.',
                          },
                        },
                      ],
                    },
                  },
                  // Code snippet preview
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        padding: '20px 28px',
                        background: 'rgba(0,0,0,0.6)',
                        border: '1px solid rgba(0,239,139,0.15)',
                        borderRadius: '8px',
                        marginTop: '8px',
                        fontSize: '16px',
                        lineHeight: '1.6',
                      },
                      children: [
                        {
                          type: 'span',
                          props: {
                            style: { color: 'rgba(16,185,129,0.4)' },
                            children: '// Simulate any Flow transaction',
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: { display: 'flex', gap: '0px' },
                            children: [
                              {
                                type: 'span',
                                props: {
                                  style: { color: '#10b981' },
                                  children: 'import',
                                },
                              },
                              {
                                type: 'span',
                                props: {
                                  style: { color: '#d1fae5' },
                                  children: ' FlowToken ',
                                },
                              },
                              {
                                type: 'span',
                                props: {
                                  style: { color: '#10b981' },
                                  children: 'from ',
                                },
                              },
                              {
                                type: 'span',
                                props: {
                                  style: { color: '#34d399' },
                                  children: '0x1654653399040a61',
                                },
                              },
                            ],
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: { display: 'flex', gap: '0px' },
                            children: [
                              {
                                type: 'span',
                                props: {
                                  style: { color: '#10b981' },
                                  children: 'transaction',
                                },
                              },
                              {
                                type: 'span',
                                props: {
                                  style: { color: '#6ee7b7' },
                                  children: '(amount: UFix64) { ... }',
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            // Bottom URL
            {
              type: 'div',
              props: {
                style: {
                  position: 'absolute',
                  bottom: '24px',
                  right: '40px',
                  fontSize: '16px',
                  color: 'rgba(255,255,255,0.3)',
                  letterSpacing: '2px',
                  fontWeight: 600,
                },
                children: 'simulate.flowindex.io',
              },
            },
          ],
        },
      },
      {
        width: 1200,
        height: 630,
        fonts: [
          {
            name: 'Inter',
            data: font,
            weight: 400,
            style: 'normal',
          },
        ],
      }
    )

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
    })
    const pngData = resvg.render()
    const pngBuffer = pngData.asPng()

    setResponseHeaders(event, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
    })

    return pngBuffer
  } catch (err) {
    console.error('OG image generation failed:', err)
    throw createError({ statusCode: 500, message: 'Failed to generate OG image' })
  }
})
