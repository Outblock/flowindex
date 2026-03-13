import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

Config.overrideWebpackConfig((currentConfiguration) => {
  return enableTailwind(currentConfiguration);
});

// Required for Three.js / WebGL rendering in headless Chrome
Config.setChromiumOpenGlRenderer("angle");
Config.setConcurrency(1);
