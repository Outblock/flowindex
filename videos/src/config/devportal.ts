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
