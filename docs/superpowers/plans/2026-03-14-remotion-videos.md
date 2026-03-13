# Remotion Video Generation System — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Remotion-based video generation system in `videos/` that produces social media marketing videos for FlowIndex products (Explorer, Simulator, DevPortal), reusing existing Three.js animation assets.

**Architecture:** Top-level `videos/` directory as an independent workspace package. Templates are parameterized Remotion compositions driven by per-product config files. Existing `GridScan` shader and `NodeGlobe` Three.js components are adapted to Remotion's frame-driven rendering model via `@remotion/three` and `useCurrentFrame()`.

**Tech Stack:** Remotion 4, React 19, TypeScript, TailwindCSS, Three.js, `@remotion/three`, `@remotion/transitions`, Zod (for parametric props)

**Spec:** `docs/superpowers/specs/2026-03-14-remotion-videos-design.md`

---

## Chunk 1: Project Scaffold & First Composition

### Task 1: Initialize Remotion project

**Files:**
- Create: `videos/package.json`
- Create: `videos/tsconfig.json`
- Create: `videos/remotion.config.ts`
- Create: `videos/src/Root.tsx`
- Create: `videos/src/lib/constants.ts`
- Create: `videos/src/lib/theme.ts`
- Modify: root `package.json` (add workspace entry if using workspaces)

- [ ] **Step 1: Create `videos/package.json`**

```json
{
  "name": "videos",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "remotion studio",
    "build": "remotion bundle",
    "render": "remotion render",
    "render:all": "bun run scripts/render-all.ts"
  },
  "dependencies": {
    "remotion": "^4.0.0",
    "@remotion/cli": "^4.0.0",
    "@remotion/bundler": "^4.0.0",
    "@remotion/three": "^4.0.0",
    "@remotion/transitions": "^4.0.0",
    "@remotion/zod-types": "^4.0.0",
    "@remotion/tailwind": "^4.0.0",
    "three": "^0.167.1",
    "@react-three/fiber": "^9.0.0",
    "@types/three": "^0.167.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/react": "^19.0.0"
  }
}
```

- [ ] **Step 2: Create `videos/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `videos/remotion.config.ts`**

```ts
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind";

Config.overrideWebpackConfig((config) => {
  return enableTailwind(config);
});
```

Note: Check the Remotion docs for the exact TailwindCSS setup. Run `WebFetch https://www.remotion.dev/docs/tailwind` to get the latest instructions. The above is the general pattern but may need adjustment for Remotion 4.

- [ ] **Step 4: Create `videos/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

- [ ] **Step 5: Create `videos/src/lib/constants.ts`**

```ts
export const FPS = 30;
export const DEFAULT_DURATION_SEC = 15;
export const DEFAULT_DURATION_FRAMES = DEFAULT_DURATION_SEC * FPS;

export const FORMATS = {
  portrait: { width: 1080, height: 1920 },   // 9:16
  square: { width: 1080, height: 1080 },     // 1:1
  landscape: { width: 1920, height: 1080 },  // 16:9
} as const;

export type FormatKey = keyof typeof FORMATS;
```

- [ ] **Step 6: Create `videos/src/lib/theme.ts`**

Define brand colors and font families used across all videos. Pull the primary colors from the existing frontend TailwindCSS config.

```ts
export const BRAND = {
  flowGreen: "#00EF8B",
  flowPurple: "#6B5CE7",
  dark: "#0A0A0A",
  light: "#FAFAFA",
  white: "#FFFFFF",
} as const;

export const FONTS = {
  heading: "Inter, system-ui, sans-serif",
  mono: "JetBrains Mono, monospace",
} as const;
```

- [ ] **Step 7: Create minimal `videos/src/Root.tsx`**

```tsx
import { Composition } from "remotion";
import { FPS, FORMATS, DEFAULT_DURATION_FRAMES } from "./lib/constants";

// Placeholder — will be replaced by real compositions in Task 2
const Placeholder: React.FC = () => (
  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#0A0A0A", color: "#00EF8B", fontFamily: "Inter, sans-serif", fontSize: 48 }}>
    FlowIndex Videos
  </div>
);

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="placeholder"
      component={Placeholder}
      durationInFrames={DEFAULT_DURATION_FRAMES}
      fps={FPS}
      width={FORMATS.portrait.width}
      height={FORMATS.portrait.height}
    />
  );
};
```

- [ ] **Step 8: Install dependencies and verify Remotion Studio starts**

```bash
cd videos && bun install
```

```bash
cd videos && bun run dev
```

Expected: Remotion Studio opens in browser showing the placeholder composition.

- [ ] **Step 9: Commit**

```bash
git add videos/
git commit -m "feat(videos): scaffold Remotion project with constants and theme"
```

---

### Task 2: Product config system with Zod schema

**Files:**
- Create: `videos/src/config/schema.ts`
- Create: `videos/src/config/explorer.ts`
- Create: `videos/src/config/simulator.ts`
- Create: `videos/src/config/devportal.ts`
- Create: `videos/src/config/index.ts`

- [ ] **Step 1: Create `videos/src/config/schema.ts`**

Define the Zod schema for product video configuration. This schema makes compositions parametric in Remotion Studio.

```ts
import { z } from "zod";
import { zColor } from "@remotion/zod-types";

export const ProductConfigSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  features: z.array(z.string()).min(1).max(6),
  colors: z.object({
    primary: zColor(),
    secondary: zColor(),
    background: zColor(),
  }),
  background: z.enum(["gridScan", "nodeGlobe", "solid"]),
  url: z.string().optional(),
});

export type ProductConfig = z.infer<typeof ProductConfigSchema>;
```

- [ ] **Step 2: Create `videos/src/config/explorer.ts`**

```ts
import type { ProductConfig } from "./schema";

export const explorerConfig: ProductConfig = {
  name: "FlowIndex Explorer",
  tagline: "Real-time Flow blockchain explorer",
  features: [
    "Live block streaming",
    "Full EVM support",
    "Token & NFT tracking",
    "Staking analytics",
    "Smart contract viewer",
  ],
  colors: {
    primary: "#00EF8B",
    secondary: "#6B5CE7",
    background: "#0A0A0A",
  },
  background: "gridScan",
  url: "flowindex.io",
};
```

- [ ] **Step 3: Create `videos/src/config/simulator.ts`**

```ts
import type { ProductConfig } from "./schema";

export const simulatorConfig: ProductConfig = {
  name: "FlowIndex Simulator",
  tagline: "Test transactions on mainnet fork",
  features: [
    "Mainnet fork mode",
    "Real contract state",
    "Instant execution",
    "Balance tracking",
  ],
  colors: {
    primary: "#FF9F43",
    secondary: "#00EF8B",
    background: "#0A0A0A",
  },
  background: "gridScan",
  url: "simulate.flowindex.io",
};
```

- [ ] **Step 4: Create `videos/src/config/devportal.ts`**

```ts
import type { ProductConfig } from "./schema";

export const devportalConfig: ProductConfig = {
  name: "FlowIndex DevPortal",
  tagline: "API docs & developer tools",
  features: [
    "OpenAPI reference",
    "Webhook integration",
    "Real-time WebSocket API",
    "Cadence playground",
  ],
  colors: {
    primary: "#6B5CE7",
    secondary: "#00EF8B",
    background: "#0A0A0A",
  },
  background: "solid",
  url: "docs.flowindex.io",
};
```

- [ ] **Step 5: Create `videos/src/config/index.ts`**

```ts
export { ProductConfigSchema, type ProductConfig } from "./schema";
export { explorerConfig } from "./explorer";
export { simulatorConfig } from "./simulator";
export { devportalConfig } from "./devportal";
```

- [ ] **Step 6: Commit**

```bash
git add videos/src/config/
git commit -m "feat(videos): add product config system with Zod schema"
```

---

### Task 3: Text animation components

**Files:**
- Create: `videos/src/components/AnimatedText.tsx`
- Create: `videos/src/components/FeatureList.tsx`
- Create: `videos/src/components/Logo.tsx`

- [ ] **Step 1: Create `videos/src/components/AnimatedText.tsx`**

Provides fade-slide-in text animation driven by `useCurrentFrame()`. No CSS transitions or Tailwind `animate-*` classes.

```tsx
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

type AnimatedTextProps = {
  text: string;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  delay?: number; // in frames
  direction?: "up" | "down";
};

export const AnimatedText: React.FC<AnimatedTextProps> = ({
  text,
  fontSize = 48,
  color = "#FFFFFF",
  fontFamily = "Inter, system-ui, sans-serif",
  delay = 0,
  direction = "up",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const adjustedFrame = Math.max(0, frame - delay);
  const opacity = interpolate(adjustedFrame, [0, fps * 0.5], [0, 1], {
    extrapolateRight: "clamp",
  });

  const translateY = interpolate(
    spring({ frame: adjustedFrame, fps, config: { damping: 200 } }),
    [0, 1],
    [direction === "up" ? 30 : -30, 0]
  );

  return (
    <div
      style={{
        fontSize,
        color,
        fontFamily,
        fontWeight: 700,
        opacity,
        transform: `translateY(${translateY}px)`,
        lineHeight: 1.2,
      }}
    >
      {text}
    </div>
  );
};
```

- [ ] **Step 2: Create `videos/src/components/FeatureList.tsx`**

Staggered feature list — each item fades in with a delay.

```tsx
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { FONTS } from "../lib/theme";

type FeatureListProps = {
  features: string[];
  color?: string;
  accentColor?: string;
  startFrame?: number;
  staggerFrames?: number;
};

export const FeatureList: React.FC<FeatureListProps> = ({
  features,
  color = "#FFFFFF",
  accentColor = "#00EF8B",
  startFrame = 0,
  staggerFrames = 8,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {features.map((feature, i) => {
        const itemFrame = Math.max(0, frame - startFrame - i * staggerFrames);
        const opacity = interpolate(itemFrame, [0, fps * 0.3], [0, 1], {
          extrapolateRight: "clamp",
        });
        const translateX = interpolate(
          spring({ frame: itemFrame, fps, config: { damping: 200 } }),
          [0, 1],
          [40, 0]
        );

        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              opacity,
              transform: `translateX(${translateX}px)`,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: accentColor,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 28,
                color,
                fontFamily: FONTS.heading,
                fontWeight: 500,
              }}
            >
              {feature}
            </span>
          </div>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 3: Create `videos/src/components/Logo.tsx`**

Simple logo/brand reveal with scale + fade spring animation.

```tsx
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { BRAND, FONTS } from "../lib/theme";

type LogoProps = {
  name?: string;
  color?: string;
  delay?: number;
};

export const Logo: React.FC<LogoProps> = ({
  name = "FlowIndex",
  color = BRAND.flowGreen,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const adjustedFrame = Math.max(0, frame - delay);

  const scale = interpolate(
    spring({ frame: adjustedFrame, fps, config: { damping: 100, mass: 0.5 } }),
    [0, 1],
    [0.8, 1]
  );

  const opacity = interpolate(adjustedFrame, [0, fps * 0.3], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: color,
        }}
      />
      <span
        style={{
          fontSize: 32,
          fontFamily: FONTS.heading,
          fontWeight: 700,
          color: "#FFFFFF",
        }}
      >
        {name}
      </span>
    </div>
  );
};
```

- [ ] **Step 4: Verify components render in isolation**

Temporarily add a test composition in Root.tsx that renders AnimatedText. Open Remotion Studio and confirm the animation plays smoothly.

- [ ] **Step 5: Commit**

```bash
git add videos/src/components/
git commit -m "feat(videos): add text animation and logo components"
```

---

### Task 4: ProductIntro template composition

**Files:**
- Create: `videos/src/compositions/ProductIntro.tsx`
- Modify: `videos/src/Root.tsx`

- [ ] **Step 1: Create `videos/src/compositions/ProductIntro.tsx`**

A 15-second product intro video with 3 scenes:
1. Logo reveal + product name + tagline (0–4s)
2. Feature list with staggered reveal (4–11s)
3. CTA / URL + logo (11–15s)

Uses `TransitionSeries` for scene transitions with fade effects.

```tsx
import { AbsoluteFill, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import type { z } from "zod";
import type { ProductConfigSchema } from "../config/schema";
import { AnimatedText } from "../components/AnimatedText";
import { FeatureList } from "../components/FeatureList";
import { Logo } from "../components/Logo";
import { FONTS } from "../lib/theme";

type ProductIntroProps = z.infer<typeof ProductConfigSchema>;

const TRANSITION_FRAMES = 15;

export const ProductIntro: React.FC<ProductIntroProps> = ({
  name,
  tagline,
  features,
  colors,
  url,
}) => {
  const { fps, durationInFrames } = useVideoConfig();

  const scene1Dur = Math.round(4 * fps);
  const scene3Dur = Math.round(4 * fps);
  const scene2Dur = durationInFrames - scene1Dur - scene3Dur + TRANSITION_FRAMES * 2;

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <TransitionSeries>
        {/* Scene 1: Logo + Tagline */}
        <TransitionSeries.Sequence durationInFrames={scene1Dur}>
          <AbsoluteFill
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 60,
              gap: 24,
            }}
          >
            <Logo name={name} color={colors.primary} />
            <AnimatedText
              text={tagline}
              fontSize={36}
              color="#CCCCCC"
              delay={Math.round(fps * 0.8)}
            />
          </AbsoluteFill>
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Scene 2: Features */}
        <TransitionSeries.Sequence durationInFrames={scene2Dur}>
          <AbsoluteFill
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: 60,
              gap: 32,
            }}
          >
            <AnimatedText text="Features" fontSize={24} color={colors.primary} />
            <FeatureList
              features={features}
              accentColor={colors.primary}
              startFrame={Math.round(fps * 0.3)}
            />
          </AbsoluteFill>
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Scene 3: CTA */}
        <TransitionSeries.Sequence durationInFrames={scene3Dur}>
          <AbsoluteFill
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 24,
            }}
          >
            <Logo name={name} color={colors.primary} />
            {url && (
              <AnimatedText
                text={url}
                fontSize={28}
                color={colors.primary}
                fontFamily={FONTS.mono}
                delay={Math.round(fps * 0.5)}
              />
            )}
          </AbsoluteFill>
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Update `videos/src/Root.tsx` to register ProductIntro for all products x formats**

```tsx
import { Composition, Folder } from "remotion";
import { FPS, FORMATS, DEFAULT_DURATION_FRAMES, type FormatKey } from "./lib/constants";
import { ProductConfigSchema, type ProductConfig } from "./config/schema";
import { explorerConfig } from "./config/explorer";
import { simulatorConfig } from "./config/simulator";
import { devportalConfig } from "./config/devportal";
import { ProductIntro } from "./compositions/ProductIntro";

const products: Record<string, ProductConfig> = {
  explorer: explorerConfig,
  simulator: simulatorConfig,
  devportal: devportalConfig,
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {Object.entries(products).map(([key, config]) => (
        <Folder key={key} name={key}>
          {(Object.entries(FORMATS) as [FormatKey, { width: number; height: number }][]).map(
            ([format, { width, height }]) => (
              <Composition
                key={`${key}-intro-${format}`}
                id={`${key}-intro-${format}`}
                component={ProductIntro}
                durationInFrames={DEFAULT_DURATION_FRAMES}
                fps={FPS}
                width={width}
                height={height}
                schema={ProductConfigSchema}
                defaultProps={config}
              />
            )
          )}
        </Folder>
      ))}
    </>
  );
};
```

- [ ] **Step 3: Open Remotion Studio, verify all 9 compositions render**

```bash
cd videos && bun run dev
```

Expected: Sidebar shows folders (explorer, simulator, devportal) each with 3 compositions (intro-portrait, intro-square, intro-landscape). Playing any shows the 3-scene intro video.

- [ ] **Step 4: Render one video to verify output**

```bash
cd videos && bunx remotion render explorer-intro-portrait --output out/explorer-intro-portrait.mp4
```

Expected: MP4 file generated in `videos/out/`.

- [ ] **Step 5: Add `out/` to `.gitignore`**

Create `videos/.gitignore`:
```
out/
node_modules/
dist/
```

- [ ] **Step 6: Commit**

```bash
git add videos/
git commit -m "feat(videos): add ProductIntro template with all product compositions"
```

---

## Chunk 2: Animation Adapters & Advanced Templates

### Task 5: GridScan adapter for Remotion

**Files:**
- Create: `videos/src/components/adapters/GridScanVideo.tsx`

The original `GridScan` component uses `requestAnimationFrame` and `performance.now()` for time. In Remotion, ALL animation must be driven by `useCurrentFrame()`. The adapter:
1. Extracts the GLSL shaders (vertex + fragment) from the original
2. Uses `@remotion/three`'s `ThreeCanvas` to render the shader
3. Drives `iTime` uniform from `useCurrentFrame() / fps` instead of `performance.now()`
4. Removes all mouse/gyro interaction (not applicable in video)

- [ ] **Step 1: Create `videos/src/components/adapters/GridScanVideo.tsx`**

```tsx
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import { useRef, useMemo } from "react";

// Import the GLSL shaders inline (copied from frontend/app/components/GridScan.tsx)
// Only the vertex and fragment strings are needed.

const vert = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Copy the full `frag` shader string from frontend/app/components/GridScan.tsx lines 17–271
// (the entire fragment shader source)

const frag = `/* ... copy full fragment shader from GridScan.tsx ... */`;

type GridScanVideoProps = {
  linesColor?: string;
  scanColor?: string;
  scanOpacity?: number;
  gridScale?: number;
  lineThickness?: number;
  scanDuration?: number;
  scanDelay?: number;
};

function srgbColor(hex: string) {
  const c = new THREE.Color(hex);
  return c.convertSRGBToLinear();
}

const GridScanMesh: React.FC<GridScanVideoProps> = ({
  linesColor = "#392e4e",
  scanColor = "#FF9FFC",
  scanOpacity = 0.4,
  gridScale = 0.1,
  lineThickness = 1,
  scanDuration = 2.0,
  scanDelay = 2.0,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const time = frame / fps;
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      iResolution: { value: new THREE.Vector3(width, height, 1) },
      iTime: { value: 0 },
      uSkew: { value: new THREE.Vector2(0, 0) },
      uTilt: { value: 0 },
      uYaw: { value: 0 },
      uLineThickness: { value: lineThickness },
      uLinesColor: { value: srgbColor(linesColor) },
      uScanColor: { value: srgbColor(scanColor) },
      uGridScale: { value: gridScale },
      uLineStyle: { value: 0 },
      uLineJitter: { value: 0.1 },
      uScanOpacity: { value: scanOpacity },
      uNoise: { value: 0.01 },
      uBloomOpacity: { value: 0 },
      uScanGlow: { value: 0.5 },
      uScanSoftness: { value: 2.0 },
      uPhaseTaper: { value: 0.9 },
      uScanDuration: { value: scanDuration },
      uScanDelay: { value: scanDelay },
      uScanDirection: { value: 2 }, // pingpong
      uScanStarts: { value: new Array(8).fill(0) },
      uScanCount: { value: 0 },
    }),
    // Intentionally static — we update iTime per-frame below
    []
  );

  // Drive time from frame (CRITICAL: no requestAnimationFrame)
  if (materialRef.current) {
    materialRef.current.uniforms.iTime.value = time;
  }

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={vert}
        fragmentShader={frag}
        transparent
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
};

export const GridScanVideo: React.FC<GridScanVideoProps> = (props) => {
  const { width, height } = useVideoConfig();

  return (
    <ThreeCanvas
      width={width}
      height={height}
      camera={{ position: [0, 0, 1], fov: 90 }}
      style={{ position: "absolute", top: 0, left: 0 }}
    >
      <GridScanMesh {...props} />
    </ThreeCanvas>
  );
};
```

**Important implementation notes:**
- Copy the FULL fragment shader string from `frontend/app/components/GridScan.tsx` (lines 17–271). Do not modify the shader logic.
- The `ThreeCanvas` MUST have explicit `width` and `height` props.
- `useFrame()` from `@react-three/fiber` is FORBIDDEN in Remotion. Drive uniforms directly from `useCurrentFrame()`.
- The mesh uses an orthographic-style fullscreen quad (`PlaneGeometry(2,2)` with vertex shader that uses `position.xy` directly).

- [ ] **Step 2: Test GridScanVideo in a temporary composition**

Add a temporary composition in Root.tsx:
```tsx
<Composition
  id="test-gridscan"
  component={GridScanVideo}
  durationInFrames={150}
  fps={30}
  width={1080}
  height={1920}
/>
```

Open Remotion Studio, verify the grid animation plays smoothly driven by frames.

- [ ] **Step 3: Commit**

```bash
git add videos/src/components/adapters/
git commit -m "feat(videos): add GridScan adapter for Remotion (frame-driven)"
```

---

### Task 6: Background component that switches per config

**Files:**
- Create: `videos/src/components/Background.tsx`

- [ ] **Step 1: Create `videos/src/components/Background.tsx`**

Renders the appropriate background based on the product config's `background` field.

```tsx
import { AbsoluteFill } from "remotion";
import { GridScanVideo } from "./adapters/GridScanVideo";

type BackgroundProps = {
  type: "gridScan" | "nodeGlobe" | "solid";
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
};

export const Background: React.FC<BackgroundProps> = ({
  type,
  primaryColor,
  secondaryColor,
  backgroundColor,
}) => {
  if (type === "gridScan") {
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ backgroundColor }} />
        <GridScanVideo
          linesColor={secondaryColor}
          scanColor={primaryColor}
          scanOpacity={0.3}
        />
      </AbsoluteFill>
    );
  }

  // "solid" and "nodeGlobe" (nodeGlobe can be added later as Task 7)
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at center, ${backgroundColor} 0%, #000000 100%)`,
      }}
    />
  );
};
```

- [ ] **Step 2: Integrate Background into ProductIntro**

Modify `ProductIntro.tsx` to render `<Background>` behind the `<TransitionSeries>`:

```tsx
// Add at the top of the component's return, inside the outer AbsoluteFill:
<Background
  type={background}
  primaryColor={colors.primary}
  secondaryColor={colors.secondary}
  backgroundColor={colors.background}
/>
<TransitionSeries>
  {/* ... existing scenes ... */}
</TransitionSeries>
```

The `background` prop comes from the ProductConfig (already part of `ProductConfigSchema`).

- [ ] **Step 3: Test in Remotion Studio — explorer should show GridScan, devportal should show solid**

- [ ] **Step 4: Commit**

```bash
git add videos/src/components/Background.tsx videos/src/compositions/ProductIntro.tsx
git commit -m "feat(videos): add configurable background component with GridScan integration"
```

---

### Task 7: NodeGlobe adapter (optional/stretch)

**Files:**
- Create: `videos/src/components/adapters/NodeGlobeVideo.tsx`
- Modify: `videos/src/components/Background.tsx`

This task adapts the Three.js globe from `frontend/app/components/NodeGlobe.tsx`. It's more complex because it uses:
- PerspectiveCamera with auto-rotation
- Fibonacci sphere points
- Country border lines (GeoJSON fetch)
- Animated arcs

For Remotion:
- Camera rotation driven by `useCurrentFrame()` instead of rAF
- Arc spawn/update logic driven by frame time
- No pointer interaction
- GeoJSON loaded via `staticFile()` or bundled inline (no runtime fetch in render)

- [ ] **Step 1: Create `videos/src/components/adapters/NodeGlobeVideo.tsx`**

Use `ThreeCanvas` from `@remotion/three`. Create React Three Fiber components for:
- Globe sphere mesh
- Surface dots (fibonacci sphere — reuse the `buildSurfaceDots` math)
- Auto-rotating pivot group driven by `frame * 0.002`
- Static arcs (pre-computed, no random spawning — deterministic for rendering)

Key constraint: All animation via `useCurrentFrame()`. No `useFrame()`.

```tsx
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";

const GLOBE_RADIUS = 1.6;
const SURFACE_DOT_COUNT = 12000;

// Simplified globe — auto-rotates, no interaction, no async GeoJSON
// For a production version, bundle the GeoJSON as a static asset

const GlobeMesh: React.FC = () => {
  const frame = useCurrentFrame();
  const rotationY = frame * 0.008;

  return (
    <group rotation={[0.3, rotationY, 0]}>
      {/* Globe sphere */}
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
        <meshBasicMaterial color="#050505" transparent opacity={0.95} />
      </mesh>
      {/* Surface dots would go here — use instanced mesh for performance */}
    </group>
  );
};

export const NodeGlobeVideo: React.FC = () => {
  const { width, height } = useVideoConfig();

  return (
    <ThreeCanvas
      width={width}
      height={height}
      camera={{ position: [0, 0, 4.6], fov: 45 }}
      style={{ position: "absolute", top: 0, left: 0 }}
    >
      <GlobeMesh />
    </ThreeCanvas>
  );
};
```

This is a simplified version. The full implementation should port the fibonacci dots, arcs, and optionally the country borders from the original component.

- [ ] **Step 2: Add `"nodeGlobe"` case to `Background.tsx`**

```tsx
if (type === "nodeGlobe") {
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor }} />
      <NodeGlobeVideo />
    </AbsoluteFill>
  );
}
```

- [ ] **Step 3: Test with a product config that uses `background: "nodeGlobe"`**

- [ ] **Step 4: Commit**

```bash
git add videos/src/components/adapters/NodeGlobeVideo.tsx videos/src/components/Background.tsx
git commit -m "feat(videos): add NodeGlobe adapter for Remotion"
```

---

### Task 8: Batch render script

**Files:**
- Create: `videos/scripts/render-all.ts`

- [ ] **Step 1: Create `videos/scripts/render-all.ts`**

```ts
import { execSync } from "child_process";
import { mkdirSync } from "fs";

const products = ["explorer", "simulator", "devportal"];
const templates = ["intro"];
const formats = ["portrait", "square", "landscape"];

mkdirSync("out", { recursive: true });

for (const product of products) {
  for (const template of templates) {
    for (const format of formats) {
      const id = `${product}-${template}-${format}`;
      const outPath = `out/${id}.mp4`;
      console.log(`Rendering ${id}...`);
      try {
        execSync(`bunx remotion render ${id} --output ${outPath}`, {
          stdio: "inherit",
          cwd: import.meta.dirname,
        });
        console.log(`Done: ${outPath}`);
      } catch (e) {
        console.error(`Failed: ${id}`);
      }
    }
  }
}
```

- [ ] **Step 2: Test render a single product**

```bash
cd videos && bunx remotion render explorer-intro-portrait --output out/test.mp4
```

- [ ] **Step 3: Commit**

```bash
git add videos/scripts/
git commit -m "feat(videos): add batch render script"
```

---

### Task 9: Final cleanup and documentation

**Files:**
- Create: `videos/README.md`

- [ ] **Step 1: Create `videos/README.md`**

```markdown
# FlowIndex Marketing Videos

Remotion-based video generation for FlowIndex products.

## Quick Start

```bash
cd videos
bun install
bun run dev      # Open Remotion Studio
```

## Render

```bash
# Single video
bunx remotion render explorer-intro-portrait --output out/explorer-intro.mp4

# All videos
bun run render:all
```

## Adding a new product

1. Create `src/config/<product>.ts` with a `ProductConfig` export
2. Import and add to the `products` map in `src/Root.tsx`
3. All template x format combinations are auto-registered

## Adding a new template

1. Create `src/compositions/<Template>.tsx`
2. Register in `src/Root.tsx` with a new composition per product x format
3. Update `scripts/render-all.ts` templates array
```

- [ ] **Step 2: Final verification — open Studio, play all compositions, render one**

- [ ] **Step 3: Commit**

```bash
git add videos/
git commit -m "docs(videos): add README and finalize project structure"
```
