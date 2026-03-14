import React from 'react';

interface CodeRendererProps {
  animation: string;
  animationDuration: string;
  animationTimingFunction: string;
}

interface RendererNode {
  children: { value: string; properties?: { className?: string[]; style?: React.CSSProperties } }[];
  properties?: { style?: React.CSSProperties };
}

const customCodeRenderer = ({ animation, animationDuration, animationTimingFunction }: CodeRendererProps) => {
  return ({ rows, stylesheet, useInlineStyles }: { rows: RendererNode[]; stylesheet: Record<string, React.CSSProperties>; useInlineStyles: boolean }) =>
    rows.map((node, i) => (
      <div key={i} style={node.properties?.style || {}}>
        {node.children.map((token, key) => {
          const tokenStyles =
            useInlineStyles && stylesheet
              ? { ...stylesheet[token.properties?.className?.[1] as string], ...token.properties?.style }
              : token.properties?.style || {};

          return (
            <span key={key} style={tokenStyles}>
              {token.value &&
                token.value.split(' ').map((word, index, arr) => (
                  <span
                    key={index}
                    style={{
                      animationName: animation || '',
                      animationDuration,
                      animationTimingFunction,
                      animationIterationCount: 1,
                      whiteSpace: 'pre-wrap',
                      display: 'inline-block',
                    }}
                  >
                    {word + (index < arr.length - 1 ? ' ' : '')}
                  </span>
                ))}
            </span>
          );
        })}
      </div>
    ));
};

export default customCodeRenderer;
