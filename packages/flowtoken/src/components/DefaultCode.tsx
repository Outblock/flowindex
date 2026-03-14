'use client';

import React from 'react';
import { Prism } from 'react-syntax-highlighter';
import customCodeRenderer from './CodeRenderer';

interface DefaultCodeProps {
  node?: unknown;
  className?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  codeStyle?: Record<string, React.CSSProperties>;
  animateText: (text: React.ReactNode) => React.ReactNode;
  animation: string;
  animationDuration: string;
  animationTimingFunction: string;
  [key: string]: unknown;
}

const DefaultCode: React.FC<DefaultCodeProps> = ({
  node: _node,
  className,
  children,
  style,
  codeStyle,
  animateText,
  animation,
  animationDuration,
  animationTimingFunction,
  ...props
}) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    const textToCopy = Array.isArray(children) ? children.join('') : String(children);
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!className || !className.startsWith('language-')) {
    return <code {...props}>{animateText(children)}</code>;
  }

  return (
    <div {...props} style={style} className="relative">
      <button
        onClick={handleCopy}
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
          position: 'absolute',
          top: '0.5rem',
          right: '0.5rem',
          zIndex: 10,
          opacity: 0.7,
          cursor: 'pointer',
          borderRadius: '0.5rem',
          padding: '0.25rem 0.25rem',
          color: 'white',
        }}
        aria-label={copied ? 'Copied!' : 'Copy code'}
      >
        {copied ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
      <Prism
        style={codeStyle}
        language={className?.substring(9).trim() || ''}
        renderer={customCodeRenderer({ animation, animationDuration, animationTimingFunction }) as never}
      >
        {String(children)}
      </Prism>
    </div>
  );
};

export default DefaultCode;
