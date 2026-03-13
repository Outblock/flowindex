import { AbsoluteFill, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import type { z } from "zod";
import type { ProductConfigSchema } from "../config/schema";
import { AnimatedText } from "../components/AnimatedText";
import { FeatureList } from "../components/FeatureList";
import { Logo } from "../components/Logo";
import { Background } from "../components/Background";
import { FONTS } from "../lib/theme";

type ProductIntroProps = z.infer<typeof ProductConfigSchema>;

const TRANSITION_FRAMES = 15;

export const ProductIntro: React.FC<ProductIntroProps> = ({
  name,
  tagline,
  features,
  colors,
  background,
  url,
}) => {
  const { fps, durationInFrames } = useVideoConfig();

  const scene1Dur = Math.round(4 * fps);
  const scene3Dur = Math.round(4 * fps);
  const scene2Dur =
    durationInFrames - scene1Dur - scene3Dur + TRANSITION_FRAMES * 2;

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <Background
        type={background}
        primaryColor={colors.primary}
        secondaryColor={colors.secondary}
        backgroundColor={colors.background}
      />
      <TransitionSeries>
        {/* Scene 1: Logo + Tagline */}
        <TransitionSeries.Sequence durationInFrames={scene1Dur}>
          <AbsoluteFill
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 60,
              gap: 24,
            }}
          >
            <Logo name={name} color={colors.primary} />
            <AnimatedText
              text={tagline}
              fontSize={36}
              color="#CCCCCC"
              delay={Math.round(fps * 0.8)}
            />
          </AbsoluteFill>
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Scene 2: Features */}
        <TransitionSeries.Sequence durationInFrames={scene2Dur}>
          <AbsoluteFill
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: 60,
              gap: 32,
            }}
          >
            <AnimatedText
              text="Features"
              fontSize={24}
              color={colors.primary}
            />
            <FeatureList
              features={features}
              accentColor={colors.primary}
              startFrame={Math.round(fps * 0.3)}
            />
          </AbsoluteFill>
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />

        {/* Scene 3: CTA */}
        <TransitionSeries.Sequence durationInFrames={scene3Dur}>
          <AbsoluteFill
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 24,
            }}
          >
            <Logo name={name} color={colors.primary} />
            {url && (
              <AnimatedText
                text={url}
                fontSize={28}
                color={colors.primary}
                fontFamily={FONTS.mono}
                delay={Math.round(fps * 0.5)}
              />
            )}
          </AbsoluteFill>
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
