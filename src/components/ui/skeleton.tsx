/**
 * Loading placeholder (Spec 05 §6.1). Must match the final layout's
 * dimensions so content never shifts when data lands; never a spinner.
 * The shimmer is a CSS animation so reduced motion turns it off for free.
 */
import { cx } from '@/lib/cx';

export type SkeletonShape = 'text' | 'block' | 'circle';

export interface SkeletonProps {
  shape?: SkeletonShape;
  /** Any CSS length; defaults depend on the shape. */
  width?: string;
  height?: string;
  className?: string;
}

export function Skeleton({ shape = 'text', width, height, className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      style={{ width, height }}
      className={cx(
        'block animate-pulse bg-band motion-reduce:animate-none',
        shape === 'text' && 'h-4 w-full rounded-sm',
        shape === 'block' && 'h-24 w-full rounded-control',
        shape === 'circle' && 'size-10 rounded-full',
        className,
      )}
    />
  );
}

/** A zebra list of skeleton rows mirroring the app's 48 px data rows. */
export function SkeletonRows({ count, className }: { count: number; className?: string }) {
  return (
    <div className={cx('zebra', className)}>
      {Array.from({ length: count }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows, never reordered
          key={index}
          className="flex h-12 items-center justify-between gap-4 px-4"
        >
          <Skeleton width={`${55 - (index % 3) * 10}%`} />
          <Skeleton width="18%" />
        </div>
      ))}
    </div>
  );
}
