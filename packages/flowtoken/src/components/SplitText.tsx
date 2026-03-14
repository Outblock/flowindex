import React, { useRef, useEffect, useMemo } from 'react';

interface TokenWithSource {
  text: string;
  source: number;
}

interface TokenizedTextProps {
  input: string | React.ReactElement;
  sep: 'word' | 'char' | 'diff';
  animation: string | string[];
  animationDuration: string;
  animationTimingFunction: string;
  animationIterationCount: number;
}

const noAnimation = (animation: string | string[]): boolean =>
  animation === 'none' || !animation || (Array.isArray(animation) && animation.length === 0);

const isTokenWithSource = (token: unknown): token is TokenWithSource =>
  token !== null && typeof token === 'object' && 'text' in (token as object) && 'source' in (token as object);

const TokenizedText: React.FC<TokenizedTextProps> = ({
  input,
  sep,
  animation,
  animationDuration,
  animationTimingFunction,
  animationIterationCount,
}) => {
  const prevInputRef = useRef('');
  const tokensWithSources = useRef<TokenWithSource[]>([]);
  const fullTextRef = useRef('');

  const tokens = useMemo(() => {
    if (noAnimation(animation)) return null;
    if (React.isValidElement(input)) return [input];
    if (typeof input !== 'string') return null;

    if (sep === 'diff') {
      if (!prevInputRef.current || input.length < prevInputRef.current.length) {
        tokensWithSources.current = [];
        fullTextRef.current = '';
      }

      if (input !== prevInputRef.current) {
        if (input.includes(fullTextRef.current)) {
          const uniqueNewContent = input.slice(fullTextRef.current.length);
          if (uniqueNewContent.length > 0) {
            tokensWithSources.current.push({
              text: uniqueNewContent,
              source: tokensWithSources.current.length,
            });
            fullTextRef.current = input;
          }
        } else {
          tokensWithSources.current = [{ text: input, source: 0 }];
          fullTextRef.current = input;
        }
      }

      return tokensWithSources.current;
    }

    let splitRegex: RegExp;
    if (sep === 'word') {
      splitRegex = /(\s+)/;
    } else if (sep === 'char') {
      splitRegex = /(.)/;
    } else {
      throw new Error('Invalid separator: must be "word", "char", or "diff"');
    }
    return input.split(splitRegex).filter((token) => token.length > 0);
  }, [input, sep, animation]);

  useEffect(() => {
    if (typeof input === 'string') {
      prevInputRef.current = input;
    }
  }, [input]);

  // Multi-animation support: build comma-separated animation shorthand
  const animationStyle = useMemo(() => {
    const anims = Array.isArray(animation) ? animation : [animation];
    return {
      animation: anims
        .map((a) => `${a} ${animationDuration} ${animationTimingFunction} ${animationIterationCount}`)
        .join(', '),
      whiteSpace: 'pre-wrap' as const,
      display: 'inline-block' as const,
    };
  }, [animation, animationDuration, animationTimingFunction, animationIterationCount]);

  // No animation — render input directly
  if (noAnimation(animation)) {
    return <>{input}</>;
  }

  return (
    <>
      {tokens?.map((token, index) => {
        let key: number = index;
        let text = '';

        if (isTokenWithSource(token)) {
          key = token.source;
          text = token.text;
        } else if (typeof token === 'string') {
          key = index;
          text = token;
        } else if (React.isValidElement(token)) {
          key = index;
          return React.cloneElement(token, { key } as React.Attributes);
        }

        return (
          <span key={key} style={animationStyle}>
            {text}
          </span>
        );
      })}
    </>
  );
};

export default React.memo(TokenizedText);
