"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";

interface DecryptedTextProps {
  text: string;
  speed?: number;
  maxIterations?: number;
  sequential?: boolean;
  revealDirection?: "start" | "end" | "center";
  characters?: string;
  className?: string;
  parentClassName?: string;
  animateOn?: "view" | "hover";
  animationDelay?: number;
}

const defaultCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()";

export default function DecryptedText({
  text,
  speed = 50,
  maxIterations = 10,
  sequential = false,
  revealDirection = "start",
  characters = defaultCharacters,
  className = "",
  parentClassName = "",
  animateOn = "hover",
  animationDelay = 0,
}: DecryptedTextProps) {
  const [displayText, setDisplayText] = useState(text);
  const [isAnimating, setIsAnimating] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(false);
  const iterationCount = useRef(0);
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "0px 0px -50px 0px" });

  useEffect(() => {
    if (animateOn === "view" && isInView && !hasAnimated) {
      const timeout = setTimeout(() => {
        startAnimation();
      }, animationDelay);
      return () => clearTimeout(timeout);
    }
  }, [isInView, animateOn, hasAnimated, animationDelay]);

  const startAnimation = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    iterationCount.current = 0;

    const interval = setInterval(() => {
      iterationCount.current += 1;

      setDisplayText(() => {
        if (sequential) {
          const revealedCount = Math.floor(
            (iterationCount.current / maxIterations) * text.length
          );

          return text
            .split("")
            .map((char, i) => {
              if (char === " ") return " ";

              let isRevealed: boolean;
              switch (revealDirection) {
                case "end":
                  isRevealed = i >= text.length - revealedCount;
                  break;
                case "center": {
                  const center = Math.floor(text.length / 2);
                  const distance = Math.abs(i - center);
                  isRevealed = distance < revealedCount / 2;
                  break;
                }
                default:
                  isRevealed = i < revealedCount;
              }

              return isRevealed
                ? char
                : characters[Math.floor(Math.random() * characters.length)];
            })
            .join("");
        }

        return text
          .split("")
          .map((char) => {
            if (char === " ") return " ";
            return iterationCount.current >= maxIterations
              ? char
              : characters[Math.floor(Math.random() * characters.length)];
          })
          .join("");
      });

      if (iterationCount.current >= maxIterations) {
        clearInterval(interval);
        setDisplayText(text);
        setIsAnimating(false);
        setHasAnimated(true);
      }
    }, speed);

    return () => clearInterval(interval);
  };

  const hoverProps =
    animateOn === "hover"
      ? {
          onMouseEnter: startAnimation,
        }
      : {};

  return (
    <motion.span
      ref={ref}
      className={parentClassName}
      {...hoverProps}
    >
      <span className={className}>{displayText}</span>
    </motion.span>
  );
}
