import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";

type AnimatedTextProps = {
  text: string;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  delay?: number;
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
    [direction === "up" ? 30 : -30, 0],
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
