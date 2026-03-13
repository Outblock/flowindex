import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
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
    spring({
      frame: adjustedFrame,
      fps,
      config: { damping: 100, mass: 0.5 },
    }),
    [0, 1],
    [0.8, 1],
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
