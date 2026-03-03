'use client';

import React, { useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import doccoStyle from 'react-syntax-highlighter/dist/esm/styles/hljs/docco';
import SplitText from './SplitText';
import AnimatedImage from './AnimatedImage';
import { animations } from '../utils/animations';
import DefaultCode from './DefaultCode';

const DEFAULT_CUSTOM_COMPONENTS: Record<string, (props: Record<string, unknown>) => React.ReactNode> = {};

// Build a CSS animation shorthand string from one or more keyframe names
const buildAnimationShorthand = (
  anim: string | string[],
  duration: string,
  timingFunction: string,
): string => {
  const anims = Array.isArray(anim) ? anim : [anim];
  return anims.filter(Boolean).map((a) => `${a} ${duration} ${timingFunction}`).join(', ');
};

// Function to create animation style object for non-text elements
const createAnimationStyle = (
  anim: string | string[],
  animationDuration: string,
  animationTimingFunction: string,
) => ({
  animation: anim ? buildAnimationShorthand(anim, animationDuration, animationTimingFunction) : 'none',
});

// Memoized component for text elements
const MemoizedText = React.memo(({
  children,
  animation,
  animationDuration,
  animationTimingFunction,
  sep,
}: {
  children: string | React.ReactElement;
  animation: string | string[];
  animationDuration: string;
  animationTimingFunction: string;
  sep: string;
}) => (
  <SplitText
    input={children}
    sep={sep as 'word' | 'char' | 'diff'}
    animation={animation}
    animationDuration={animationDuration}
    animationTimingFunction={animationTimingFunction}
    animationIterationCount={1}
  />
));
MemoizedText.displayName = 'MemoizedText';

interface MarkdownAnimateTextProps {
  content: string;
  sep?: 'diff' | 'word' | 'char';
  animation?: string | string[];
  animationDuration?: string;
  animationTimingFunction?: string;
  codeStyle?: Record<string, React.CSSProperties> | null;
  customComponents?: Record<string, (props: Record<string, unknown>) => React.ReactNode>;
  imgHeight?: string;
}

const MarkdownAnimateText: React.FC<MarkdownAnimateTextProps> = ({
  content,
  sep = 'diff',
  animation: animationProp = 'fadeIn',
  animationDuration = '1s',
  animationTimingFunction = 'ease-in-out',
  codeStyle = null,
  customComponents = DEFAULT_CUSTOM_COMPONENTS,
  imgHeight = '20rem',
}) => {
  // Resolve animation names through the animations map, supporting arrays
  const animation = useMemo(() => {
    if (Array.isArray(animationProp)) {
      return animationProp.map((name) => animations[name] || name);
    }
    return animations[animationProp] || animationProp;
  }, [animationProp]);

  const resolvedCodeStyle = (codeStyle || doccoStyle.docco || doccoStyle) as Record<string, React.CSSProperties>;

  const animationStyle = useMemo(
    () => createAnimationStyle(animation, animationDuration, animationTimingFunction),
    [animation, animationDuration, animationTimingFunction],
  );

  const hidePartialCustomComponents = useCallback(
    (input: string) => {
      if (!input || Object.keys(customComponents).length === 0) return input;

      const lastOpeningBracketIndex = input.lastIndexOf('<');
      if (lastOpeningBracketIndex !== -1) {
        const textAfterLastOpeningBracket = input.substring(lastOpeningBracketIndex);
        if (!textAfterLastOpeningBracket.includes('>')) {
          for (const tag of Object.keys(customComponents)) {
            if (
              textAfterLastOpeningBracket.substring(1).startsWith(tag.substring(0, textAfterLastOpeningBracket.length - 1)) ||
              textAfterLastOpeningBracket.match(new RegExp(`^<${tag}(\\s|$)`))
            ) {
              return input.substring(0, lastOpeningBracketIndex);
            }
          }
        }
      }
      return input;
    },
    [customComponents],
  );

  // Build the inline style object used for wrapping non-text animated elements
  const wrapStyle = useMemo(() => {
    const anims = Array.isArray(animation) ? animation : [animation];
    return {
      animation: anims
        .filter(Boolean)
        .map((a) => `${a} ${animationDuration} ${animationTimingFunction} 1`)
        .join(', '),
      whiteSpace: 'pre-wrap' as const,
      display: 'inline-block' as const,
    };
  }, [animation, animationDuration, animationTimingFunction]);

  const animateText = useCallback(
    (text: React.ReactNode) => {
      const items = Array.isArray(text) ? text : [text];
      if (!animation) return items;

      return items.map((item, index) => {
        if (typeof item === 'string') {
          return (
            <MemoizedText
              key={`text-${index}`}
              animation={animation}
              animationDuration={animationDuration}
              animationTimingFunction={animationTimingFunction}
              sep={sep}
            >
              {hidePartialCustomComponents(item)}
            </MemoizedText>
          );
        } else if (React.isValidElement(item)) {
          const noAnimateElementTypes = ['br', 'ul', 'ol', 'td', 'th'];
          let typeName = item.type;
          if (typeof typeName === 'function') {
            typeName = typeName.name;
          }
          if (typeof typeName === 'string' && noAnimateElementTypes.includes(typeName)) {
            return item;
          }
          return (
            <span key={`other-element-${index}`} style={wrapStyle}>
              {item}
            </span>
          );
        }
        return (
          <span key={`other-${index}`} style={wrapStyle}>
            {item as React.ReactNode}
          </span>
        );
      });
    },
    [animation, animationDuration, animationTimingFunction, sep, hidePartialCustomComponents, wrapStyle],
  );

  // For passing single animation string to sub-components that only accept string
  const firstAnimation = Array.isArray(animation) ? animation[0] || '' : animation;

  const components = useMemo(
     
    () => ({
      text: ({ node: _n, ...props }: Record<string, unknown>) => animateText((props as { children: React.ReactNode }).children),
      h1: ({ node: _n, ...props }: Record<string, unknown>) => <h1 {...props as React.HTMLAttributes<HTMLHeadingElement>}>{animateText((props as { children: React.ReactNode }).children)}</h1>,
      h2: ({ node: _n, ...props }: Record<string, unknown>) => <h2 {...props as React.HTMLAttributes<HTMLHeadingElement>}>{animateText((props as { children: React.ReactNode }).children)}</h2>,
      h3: ({ node: _n, ...props }: Record<string, unknown>) => <h3 {...props as React.HTMLAttributes<HTMLHeadingElement>}>{animateText((props as { children: React.ReactNode }).children)}</h3>,
      h4: ({ node: _n, ...props }: Record<string, unknown>) => <h4 {...props as React.HTMLAttributes<HTMLHeadingElement>}>{animateText((props as { children: React.ReactNode }).children)}</h4>,
      h5: ({ node: _n, ...props }: Record<string, unknown>) => <h5 {...props as React.HTMLAttributes<HTMLHeadingElement>}>{animateText((props as { children: React.ReactNode }).children)}</h5>,
      h6: ({ node: _n, ...props }: Record<string, unknown>) => <h6 {...props as React.HTMLAttributes<HTMLHeadingElement>}>{animateText((props as { children: React.ReactNode }).children)}</h6>,
      p: ({ node: _n, ...props }: Record<string, unknown>) => <p {...props as React.HTMLAttributes<HTMLParagraphElement>}>{animateText((props as { children: React.ReactNode }).children)}</p>,
      li: ({ node: _n, ...props }: Record<string, unknown>) => (
        <li {...props as React.LiHTMLAttributes<HTMLLIElement>} className="custom-li" style={animationStyle}>
          {animateText((props as { children: React.ReactNode }).children)}
        </li>
      ),
      a: ({ node: _n, ...props }: Record<string, unknown>) => (
        <a {...props as React.AnchorHTMLAttributes<HTMLAnchorElement>} href={(props as { href?: string }).href} target="_blank" rel="noopener noreferrer">
          {animateText((props as { children: React.ReactNode }).children)}
        </a>
      ),
      strong: ({ node: _n, ...props }: Record<string, unknown>) => <strong {...props as React.HTMLAttributes<HTMLElement>}>{animateText((props as { children: React.ReactNode }).children)}</strong>,
      em: ({ node: _n, ...props }: Record<string, unknown>) => <em {...props as React.HTMLAttributes<HTMLElement>}>{animateText((props as { children: React.ReactNode }).children)}</em>,
      code: ({ node: _n, className, children, ...props }: Record<string, unknown>) => (
        <DefaultCode
          className={className as string}
          style={animationStyle}
          codeStyle={resolvedCodeStyle}
          animateText={animateText}
          animation={firstAnimation}
          animationDuration={animationDuration}
          animationTimingFunction={animationTimingFunction}
          {...props}
        >
          {children as React.ReactNode}
        </DefaultCode>
      ),
      hr: ({ node: _n, ...props }: Record<string, unknown>) => (
        <hr
          {...props as React.HTMLAttributes<HTMLHRElement>}
          style={{
            ...animationStyle,
            whiteSpace: 'pre-wrap',
          }}
        />
      ),
      img: ({ node: _n, ...props }: Record<string, unknown>) => (
        <AnimatedImage
          src={(props as { src?: string }).src || ''}
          height={imgHeight}
          alt={(props as { alt?: string }).alt || ''}
          animation={firstAnimation}
          animationDuration={animationDuration}
          animationTimingFunction={animationTimingFunction}
          animationIterationCount={1}
        />
      ),
      table: ({ node: _n, ...props }: Record<string, unknown>) => (
        <table {...props as React.TableHTMLAttributes<HTMLTableElement>} style={animationStyle}>
          {(props as { children: React.ReactNode }).children}
        </table>
      ),
      tr: ({ node: _n, ...props }: Record<string, unknown>) => <tr {...props as React.HTMLAttributes<HTMLTableRowElement>}>{animateText((props as { children: React.ReactNode }).children)}</tr>,
      td: ({ node: _n, ...props }: Record<string, unknown>) => <td {...props as React.TdHTMLAttributes<HTMLTableCellElement>}>{animateText((props as { children: React.ReactNode }).children)}</td>,
      ...Object.entries(customComponents).reduce(
        (acc, [key, value]) => {
          acc[key] = (elements: Record<string, unknown>) => value({ ...elements, animateText });
          return acc;
        },
        {} as Record<string, (elements: Record<string, unknown>) => React.ReactNode>,
      ),
    }),
    [animateText, customComponents, animation, firstAnimation, animationDuration, animationTimingFunction, animationStyle, resolvedCodeStyle, imgHeight],
  );

  const optimizedContent = useMemo(() => content, [content]);

  return (
    <ReactMarkdown
      components={components as never}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
    >
      {optimizedContent}
    </ReactMarkdown>
  );
};

export default React.memo(MarkdownAnimateText);
