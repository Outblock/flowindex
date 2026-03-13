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
