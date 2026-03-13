import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
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
          [40, 0],
        );

        return (
          <div
            key={feature}
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
