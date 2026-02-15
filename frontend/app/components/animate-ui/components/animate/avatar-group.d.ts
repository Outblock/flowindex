import * as React from 'react';

declare const AvatarGroup: React.FC<
  React.HTMLAttributes<HTMLDivElement> & {
    invertOverlap?: boolean;
    children?: React.ReactNode;
  }
>;

declare const AvatarGroupTooltip: React.FC<{
  className?: string;
  children?: React.ReactNode;
  layout?: string;
  [key: string]: any;
}>;

export { AvatarGroup, AvatarGroupTooltip };
