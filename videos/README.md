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

# All videos (9 total: 3 products x 3 formats)
bun run render:all
```

## Compositions

| Product | Template | Formats |
|---------|----------|---------|
| explorer | intro | portrait (9:16), square (1:1), landscape (16:9) |
| simulator | intro | portrait, square, landscape |
| devportal | intro | portrait, square, landscape |

## Adding a new product

1. Create `src/config/<product>.ts` with a `ProductConfig` export
2. Import and add to the `products` map in `src/Root.tsx`
3. All template x format combinations are auto-registered

## Adding a new template

1. Create `src/compositions/<Template>.tsx`
2. Register in `src/Root.tsx` with compositions per product x format
3. Update `scripts/render-all.ts` templates array
