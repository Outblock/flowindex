import React, { useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { NanoBanana } from './NanoBanana';
import { ArrowUpRight } from 'lucide-react';

export interface BentoCardProps {
  color?: string;
  title?: string;
  description?: string;
  label?: string;
  textAutoHide?: boolean;
  disableAnimations?: boolean;
  icon?: React.ElementType;
  size?: string;
  logo?: string;
  logoPosition?: string;
}

export interface BentoProps {
  textAutoHide?: boolean;
  enableStars?: boolean;
  enableSpotlight?: boolean;
  enableBorderGlow?: boolean;
  disableAnimations?: boolean;
  spotlightRadius?: number;
  particleCount?: number;
  enableTilt?: boolean;
  glowColor?: string;
  clickEffect?: boolean;
  enableMagnetism?: boolean;
  items: BentoCardProps[];
}

const DEFAULT_SPOTLIGHT_RADIUS = 400;
const DEFAULT_GLOW_COLOR = '0, 239, 139';
const MOBILE_BREAKPOINT = 768;

const hexToRgb = (hex?: string) => {
  if (!hex) return null;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : null;
};

const MagicBento: React.FC<BentoProps> = ({
  enableBorderGlow = true,
  disableAnimations = false,
  spotlightRadius = DEFAULT_SPOTLIGHT_RADIUS,
  glowColor = DEFAULT_GLOW_COLOR,
  clickEffect = true,
  items
}) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<(HTMLDivElement | null)[]>([]);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT;

  useEffect(() => {
    if (disableAnimations || isMobile || !gridRef.current) return;

    const currentGrid = gridRef.current;

    const handleMouseMove = (e: MouseEvent) => {
      const { clientX, clientY } = e;
      
      cardsRef.current.forEach((card) => {
        if (!card) return;

        const rect = card.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const distance = Math.hypot(clientX - centerX, clientY - centerY);
        const maxDistance = spotlightRadius * 1.5;
        
        const rawIntensity = Math.max(0, 1 - distance / maxDistance);
        const intensity = Math.pow(rawIntensity, 1.2) * 1.5;
        
        if (rawIntensity > 0) {
          const moveX = (clientX - centerX) / (rect.width / 2);
          const moveY = (clientY - centerY) / (rect.height / 2);
          
          gsap.to(card, {
            rotateX: -moveY * 10 * intensity,
            rotateY: moveX * 10 * intensity,
            scale: 1 + (0.02 * intensity),
            duration: 0.6,
            ease: 'power2.out',
            overwrite: 'auto'
          });

          const relativeX = ((clientX - rect.left) / rect.width) * 100;
          const relativeY = ((clientY - rect.top) / rect.height) * 100;
          
          card.style.setProperty('--glow-x', `${relativeX}%`);
          card.style.setProperty('--glow-y', `${relativeY}%`);
          card.style.setProperty('--glow-intensity', intensity.toString());
        } else {
          gsap.to(card, {
            rotateX: 0,
            rotateY: 0,
            scale: 1,
            duration: 0.8,
            ease: 'power3.out',
            overwrite: 'auto'
          });
          card.style.setProperty('--glow-intensity', '0');
        }
      });
    };

    const handleMouseLeave = () => {
      cardsRef.current.forEach(card => {
        if (!card) return;
        gsap.to(card, { rotateX: 0, rotateY: 0, scale: 1, duration: 1, ease: 'power3.out' });
        card.style.setProperty('--glow-intensity', '0');
      });
    };

    const handleClick = (e: MouseEvent) => {
      if (!clickEffect) return;
      const card = (e.target as HTMLElement).closest('.card') as HTMLElement;
      if (!card) return;

      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const currentGlowColor = card.style.getPropertyValue('--glow-color') || glowColor;

      const pulse = document.createElement('div');
      pulse.style.cssText = `
        position: absolute;
        width: 40px;
        height: 40px;
        border: 1px solid rgba(${currentGlowColor}, 0.8);
        left: ${x}px;
        top: ${y}px;
        pointer-events: none;
        z-index: 1000;
        transform: translate(-50%, -50%);
      `;
      card.appendChild(pulse);

      gsap.fromTo(pulse, 
        { scale: 0, opacity: 1 },
        { scale: 4, opacity: 0, duration: 0.4, ease: 'power2.out', onComplete: () => pulse.remove() }
      );

      gsap.to(card, {
        scale: 0.98,
        duration: 0.1,
        yoyo: true,
        repeat: 1,
        ease: 'power2.inOut'
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    currentGrid.addEventListener('mouseleave', handleMouseLeave);
    currentGrid.addEventListener('click', handleClick);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      currentGrid.removeEventListener('mouseleave', handleMouseLeave);
      currentGrid.removeEventListener('click', handleClick);
    };
  }, [disableAnimations, isMobile, spotlightRadius, glowColor, clickEffect]);

  return (
    <>
      <style>
        {`
          .bento-section {
            --glow-x: 50%;
            --glow-y: 50%;
            --glow-intensity: 0;
            --glow-radius: ${spotlightRadius}px;
            --glow-color: ${glowColor};
          }
          
          .card--border-glow::after {
            content: '';
            position: absolute;
            inset: 0;
            padding: 1.5px;
            background: radial-gradient(var(--glow-radius) circle at var(--glow-x) var(--glow-y),
                rgba(var(--glow-color), calc(var(--glow-intensity) * 1.0)) 0%,
                rgba(var(--glow-color), calc(var(--glow-intensity) * 0.3)) 20%,
                transparent 50%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            mask-composite: exclude;
            pointer-events: none;
            opacity: 1;
            z-index: 5;
          }

          .card {
            transform-style: preserve-3d;
            perspective: 1000px;
            will-change: transform;
          }

          .card-logo {
            mix-blend-mode: luminosity;
            filter: grayscale(1) brightness(0.6);
            transition: all 0.7s ease-in-out;
          }

          .card:hover .card-logo {
            mix-blend-mode: normal;
            filter: grayscale(0) brightness(1);
            opacity: 1 !important;
            transform: scale(1.05);
          }
        `}
      </style>

      <div
        ref={gridRef}
        className="bento-section grid grid-cols-1 md:grid-cols-12 gap-4 select-none relative bg-transparent"
      >
        {items.map((card, index) => {
          return (
            <div
              key={index}
              ref={el => cardsRef.current[index] = el}
              style={{ '--glow-color': hexToRgb(card.color) || glowColor } as React.CSSProperties}
              className={`card group flex flex-col justify-between relative min-h-[300px] w-full p-8 rounded-none border border-neutral-900 overflow-hidden bg-[#050505] transition-colors duration-500 hover:bg-neutral-900/30 ${
                enableBorderGlow ? 'card--border-glow' : ''
              } ${card.size || ''}`}
            >
              {/* Logo Background */}
              {(card.logo || card.icon) && (
                <div 
                  className={`card-logo absolute inset-0 opacity-[0.35] pointer-events-none bg-no-repeat ${card.logoPosition || 'bg-right-bottom'} flex items-end justify-end p-4 overflow-hidden`} 
                  style={{ 
                    backgroundImage: card.logo ? `url(${card.logo})` : 'none',
                    backgroundSize: '60%',
                    maskImage: 'linear-gradient(to top left, black 20%, transparent 80%)',
                    WebkitMaskImage: 'linear-gradient(to top left, black 20%, transparent 80%)'
                  }} 
                >
                  {!card.logo && card.icon && (
                    <card.icon size={200} className="opacity-20 -mr-10 -mb-10 rotate-12" />
                  )}
                </div>
              )}
              
              {/* Nothing Dot Grid Background */}
              <div 
                className="absolute inset-0 opacity-[0.08] pointer-events-none" 
                style={{ 
                  backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', 
                  backgroundSize: '24px 24px' 
                }} 
              />
              
              <div className="relative z-10 flex flex-col h-full justify-between pointer-events-none">
                <div>
                  <div className="flex justify-between items-start mb-8">
                    <div className="flex gap-2">
                      {!card.logo && card.icon && (
                        <div className="p-2 bg-neutral-900 border border-neutral-800 text-[#00ef8b]">
                          <card.icon size={20} />
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] font-bold font-mono text-neutral-600 uppercase tracking-widest">
                      {card.label}
                    </span>
                  </div>
                  
                  <h3 className="text-xl font-bold text-white mb-3 uppercase tracking-tight">
                    {card.title}
                  </h3>
                  <p className="text-xs text-neutral-500 font-mono leading-relaxed max-w-sm">
                    {card.description}
                  </p>
                </div>

                <div className="mt-12 flex items-center justify-between">
                  <div className="flex gap-1">
                    {[1, 2, 3].map(dot => (
                      <div key={dot} className="w-1 h-1 bg-neutral-800" />
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-neutral-600">
                    Explore
                    <ArrowUpRight className="w-3 h-3" />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

export default MagicBento;
