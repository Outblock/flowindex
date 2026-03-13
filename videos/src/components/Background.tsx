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

  // "solid" and "nodeGlobe" (nodeGlobe can be added later)
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at center, ${backgroundColor} 0%, #000000 100%)`,
      }}
    />
  );
};
