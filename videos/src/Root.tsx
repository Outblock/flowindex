import "./index.css";
import { Composition, Folder } from "remotion";
import {
  FPS,
  FORMATS,
  DEFAULT_DURATION_FRAMES,
  type FormatKey,
} from "./lib/constants";
import {
  ProductConfigSchema,
  type ProductConfig,
} from "./config/schema";
import { explorerConfig } from "./config/explorer";
import { simulatorConfig } from "./config/simulator";
import { devportalConfig } from "./config/devportal";
import { ProductIntro } from "./compositions/ProductIntro";

const products: Record<string, ProductConfig> = {
  explorer: explorerConfig,
  simulator: simulatorConfig,
  devportal: devportalConfig,
};

const formatEntries = Object.entries(FORMATS) as [
  FormatKey,
  { width: number; height: number },
][];

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {Object.entries(products).map(([key, config]) => (
        <Folder key={key} name={key}>
          {formatEntries.map(([format, { width, height }]) => (
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
          ))}
        </Folder>
      ))}
    </>
  );
};
