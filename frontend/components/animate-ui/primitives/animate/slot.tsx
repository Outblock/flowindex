/* eslint-disable react/no-unstable-nested-components */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from 'react';
import { motion, MotionProps } from 'framer-motion';
import { cn } from '@/lib/utils'; // Ensure this path is correct or adjust

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

export interface SlotProps extends Omit<React.HTMLAttributes<HTMLElement>, keyof MotionProps>, MotionProps {
  children?: React.ReactNode;
}

const Slot = React.forwardRef<HTMLElement, SlotProps>(
  ({ children, ...props }, ref) => {
    const child = React.isValidElement(children) ? children : null;
    const childType = child ? child.type : null;

    const isMotion = child && (child.type as any)?.render?.displayName?.startsWith('Motion');

    const Component = React.useMemo(() => {
      if (!childType) return null;
      return isMotion ? childType : motion.create(childType as string | React.ComponentType<any>);
    }, [childType, isMotion]);

    if (!child || !Component) {
      return null;
    }

    return (
      <Component
        {...(child.props as object)}
        {...props}
        ref={mergeRefs((child as any).ref, ref)}
        className={cn((child.props as any).className, props.className)}
      />
    );
  }
);
Slot.displayName = 'Slot';

export { Slot };
