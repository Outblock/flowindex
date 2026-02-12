import * as React from 'react';
import { motion, MotionProps } from 'framer-motion';
import { Slot } from '../animate/slot'; // Adjust import path to local Slot since we just rewrote it

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, Omit<MotionProps, 'children' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'style'> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : motion.button;
    return (
      <Component
        ref={ref}
        whileTap={{ scale: 0.95 }}
        whileHover={{ scale: 1.05 }}
        {...props as any}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button };
