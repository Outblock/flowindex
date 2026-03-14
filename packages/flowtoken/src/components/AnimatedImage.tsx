import React from 'react';

interface AnimatedImageProps {
  src: string;
  alt: string;
  animation: string;
  animationDuration: string;
  animationTimingFunction: string;
  animationIterationCount: number;
  height?: string;
  width?: string;
  objectFit?: React.CSSProperties['objectFit'];
}

const AnimatedImage: React.FC<AnimatedImageProps> = ({
  src,
  alt,
  animation,
  animationDuration,
  animationTimingFunction,
  animationIterationCount,
  height,
  width,
  objectFit = 'contain',
}) => {
  const [isLoaded, setIsLoaded] = React.useState(false);

  const baseStyle: React.CSSProperties = {
    height: height || 'auto',
    width: width || 'auto',
    objectFit,
    maxWidth: '100%',
  };

  const imageStyle: React.CSSProperties = isLoaded
    ? {
        ...baseStyle,
        animationName: animation,
        animationDuration,
        animationTimingFunction,
        animationIterationCount,
        whiteSpace: 'pre-wrap',
      }
    : {
        ...baseStyle,
        opacity: 0.0,
        backgroundColor: '#f0f0f0',
      };

  return <img src={src} alt={alt} onLoad={() => setIsLoaded(true)} style={imageStyle} />;
};

export default AnimatedImage;
