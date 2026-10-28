import type { CSSProperties } from 'react';

interface SkeletonProps {
  className?: string;
  /** `light` for blocks that sit on the cobalt hero. */
  tone?: 'ink' | 'light';
  style?: CSSProperties;
}

/**
 * Placeholder block for layout skeletons — sharp corners, ink-line grey,
 * one shared pulse. The global `prefers-reduced-motion` rule in index.css
 * stops the animation, so it degrades to a static block.
 */
export function Skeleton({
  className = '',
  tone = 'ink',
  style,
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse ${
        tone === 'ink' ? 'bg-ink-line' : 'bg-white/25'
      } ${className}`}
      style={style}
    />
  );
}
