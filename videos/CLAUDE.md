# Videos — FlowIndex Marketing Video Generator

> Part of the [FlowIndex](../CLAUDE.md) monorepo. See root CLAUDE.md for full architecture.

## Overview

Remotion 4-based video generation system for creating social media marketing videos for FlowIndex products. All dependencies are devDependencies — videos are rendered locally, not in production.

## Structure

```
videos/
├── remotion.config.ts          # Webpack (TailwindCSS v4) + Chrome GL config
├── src/
│   ├── index.ts                # Remotion entry point (registerRoot)
│   ├── index.css               # TailwindCSS v4 import
│   ├── Root.tsx                # Registers all compositions (product x format matrix)
│   ├── compositions/           # Video templates
│   │   └── ProductIntro.tsx    # 3-scene intro: logo → features → CTA
│   ├── components/             # Reusable video components
│   │   ├── AnimatedText.tsx    # Fade + slide text animation
│   │   ├── FeatureList.tsx     # Staggered feature list
│   │   ├── Logo.tsx            # Brand logo reveal
│   │   ├── Background.tsx      # Config-driven background switcher
│   │   └── adapters/           # Frontend animation → Remotion adapters
│   │       └── GridScanVideo.tsx  # GridScan GLSL shader via @remotion/three
│   ├── config/                 # Per-product video configurations
│   │   ├── schema.ts           # Zod schema (parametric in Remotion Studio)
│   │   ├── explorer.ts
│   │   ├── simulator.ts
│   │   └── devportal.ts
│   └── lib/
│       ├── constants.ts        # FPS, durations, output format dimensions
│       └── theme.ts            # Brand colors, font families
├── scripts/
│   └── render-all.ts           # Batch render all 9 compositions
└── out/                        # Rendered videos (gitignored)
```

## Commands

```bash
bun install              # Install dependencies
bun run dev              # Open Remotion Studio (preview + edit props)
bun run render:all       # Render all 9 videos (3 products x 3 formats)

# Render a single composition
bunx remotion render explorer-intro-portrait --output out/explorer-portrait.mp4
bunx remotion render simulator-intro-square --output out/simulator-square.mp4
```

## Compositions

9 compositions auto-registered: `{product}-intro-{format}`

| Product | Formats |
|---------|---------|
| explorer | portrait (1080x1920), square (1080x1080), landscape (1920x1080) |
| simulator | portrait, square, landscape |
| devportal | portrait, square, landscape |

## Remotion Rules

- **ALL animation must be driven by `useCurrentFrame()`**. No `requestAnimationFrame`, no CSS transitions, no Tailwind `animate-*` classes, no `useFrame()` from R3F.
- **`<ThreeCanvas>` must have `width` and `height` props** from `useVideoConfig()`.
- **`<Sequence>` inside `<ThreeCanvas>` must have `layout="none"`**.
- Shader uniforms (like `iTime`) must be set from `frame / fps`, not `performance.now()`.
- Use `interpolate()` and `spring()` from `remotion` for all easing.
- Use `<TransitionSeries>` for scene transitions (fade, slide, wipe).

## Adding a New Product

1. Create `src/config/<product>.ts` exporting a `ProductConfig` object
2. Import and add to the `products` map in `src/Root.tsx`
3. All template x format combinations auto-register

## Adding a New Template

1. Create `src/compositions/<Template>.tsx` accepting `ProductConfig` props
2. Register compositions in `src/Root.tsx` (loop over products x formats)
3. Add template name to `scripts/render-all.ts` templates array

## Adapting Frontend Components

When porting animation components from `frontend/app/components/` to Remotion:

1. Create an adapter in `src/components/adapters/`
2. Replace `requestAnimationFrame` loops with `useCurrentFrame() / fps` for time
3. Remove all DOM event handlers (mouse, touch, resize)
4. Use `@remotion/three`'s `<ThreeCanvas>` instead of raw `THREE.WebGLRenderer`
5. Keep shader code identical — only change the time driver

## Gotchas

- **WebGL rendering requires `--gl=angle`** — configured in `remotion.config.ts` via `Config.setChromiumOpenGlRenderer("angle")`
- **Concurrency set to 1** for WebGL stability (multiple tabs exhaust GL contexts)
- **Remotion packages must all be the same version** — including transitive deps. Pin versions explicitly in package.json to avoid workspace hoisting mismatches.
- **Zod 4 required** by Remotion 4 (not Zod 3) — `zod@4.3.6`
- **`sideEffects: ["*.css"]`** in package.json is required for TailwindCSS to work
