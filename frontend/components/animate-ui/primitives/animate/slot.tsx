import * as React from 'react';
import { motion, MotionProps } from 'framer-motion';
import { cn } from '@/lib/utils'; // Ensure this path is correct or adjust

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergeRefs<T = any>(...refs: (React.MutableRefObject<T> | React.LegacyRef<T>)[]) {
  return (node: T) => {
    refs.forEach((ref) => {
      if (!ref) return;
      if (typeof ref === 'function') {
        ref(node);
      } else {
        (ref as React.MutableRefObject<T>).current = node;
      }
    });
  };
}

export interface SlotProps extends React.HTMLAttributes<HTMLElement>, MotionProps {
  children?: React.ReactNode;
}

const Slot = React.forwardRef<HTMLElement, SlotProps>(
  ({ children, ...props }, ref) => {
    if (!React.isValidElement(children)) {
      return null;
    }

    const child = children as React.ReactElement;

    // Check if child is already a motion component
    // strict check for Framer Motion component
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isMotion = (child.type as any)?.render?.displayName?.startsWith('Motion');

    const Component = isMotion ? child.type : motion.create(child.type as string | React.ComponentType<any>);

    return (
      <Component
        {...child.props}
        {...props}
        ref={mergeRefs((child as any).ref, ref)}
        className={cn(child.props.className, props.className)}
      />
    );
  }
);
Slot.displayName = 'Slot';

export { Slot };
