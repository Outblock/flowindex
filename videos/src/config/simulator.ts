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
