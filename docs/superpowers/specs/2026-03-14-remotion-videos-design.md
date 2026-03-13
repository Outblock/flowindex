# Remotion Video Generation System

## Overview

Add a Remotion-based video generation system to the FlowIndex monorepo for creating social media marketing videos for each product (Explorer, Simulator, DevPortal). Reuses existing animation components (GridScan, NodeGlobe) and follows a template-driven approach for multi-product, multi-format output.

## Goals

- Generate 9:16, 1:1, and 16:9 marketing videos from shared templates
- Reuse existing Three.js/GSAP animation assets as video backgrounds
- Per-product configuration (colors, copy, features, background)
- Local rendering first, CI later

## Architecture

```
videos/
├── remotion.config.ts
├── package.json
├── tsconfig.json
├── src/
│   ├── Root.tsx                    # Register all compositions
│   ├── compositions/
│   │   ├── ProductIntro.tsx        # Product intro template
│   │   ├── FeatureShowcase.tsx     # Feature highlight template
│   │   └── StatsHighlight.tsx      # Stats/metrics template
│   ├── components/
│   │   ├── adapters/
│   │   │   ├── GridScanVideo.tsx   # GridScan adapted for Remotion
│   │   │   └── NodeGlobeVideo.tsx  # NodeGlobe adapted for Remotion
│   │   ├── Typography.tsx          # Animated text (fade, slide, typewriter)
│   │   ├── Logo.tsx                # Brand logo reveal
│   │   └── Transitions.tsx         # Scene transitions (wipe, fade, zoom)
│   ├── config/
│   │   ├── explorer.ts
│   │   ├── simulator.ts
│   │   └── devportal.ts
│   └── lib/
│       ├── constants.ts            # Frame rates, durations, dimensions
│       └── theme.ts                # Brand colors, fonts
```

## Template System

Each template is a Remotion `<Composition>` that accepts a product config as input props:

```ts
interface ProductConfig {
  name: string;
  tagline: string;
  features: string[];
  colors: { primary: string; secondary: string; background: string };
  background: "gridScan" | "nodeGlobe" | "solid";
  logo?: string;
}
```

Templates are registered in `Root.tsx` with all product x format combinations:
- `explorer-intro-9x16`, `explorer-intro-1x1`, `explorer-intro-16x9`
- `simulator-features-9x16`, etc.

## Animation Asset Adaptation

Existing components need adaptation for Remotion's frame-based rendering:

- **GridScan**: Extract GLSL shaders, drive `uniform time` from `useCurrentFrame()` instead of requestAnimationFrame
- **NodeGlobe**: Use `@remotion/three` to render Three.js scenes, control camera orbit and arc animations via frame interpolation

Key Remotion APIs used:
- `useCurrentFrame()` + `interpolate()` for all animation timing
- `spring()` for natural easing on text/UI elements
- `<Sequence>` for scene ordering
- `<AbsoluteFill>` for layered composition

## Output Formats

| Format | Resolution | Use Case |
|--------|-----------|----------|
| 9:16   | 1080x1920 | Twitter/TikTok/Reels |
| 1:1    | 1080x1080 | Twitter/LinkedIn |
| 16:9   | 1920x1080 | YouTube |

All formats share the same template logic; layout adapts via props.

## Dependencies

- `remotion`, `@remotion/cli`, `@remotion/bundler` — core
- `@remotion/three` — Three.js integration
- `@remotion/tailwind` — consistent styling with frontend
- `three`, `@types/three` — 3D rendering
- `gsap` — animation utilities

## Scripts

- `bun run dev` — Remotion Studio (preview in browser)
- `bun run build` — Bundle for rendering
- `bun run render <id>` — Render single composition
- `bun run render:all` — Render all compositions

## Phases

1. **Scaffold** — Project setup, Remotion config, constants, theme
2. **Templates** — ProductIntro template with text animations and solid backgrounds
3. **Adapters** — Port GridScan and NodeGlobe for Remotion
4. **Product configs** — Explorer, Simulator, DevPortal configurations
5. **Additional templates** — FeatureShowcase, StatsHighlight
6. **Render scripts** — Batch render helpers

## Non-Goals

- CI/CD rendering pipeline (future work)
- Dynamic data fetching from live API (static config only)
- Audio/voiceover support (can add later)
