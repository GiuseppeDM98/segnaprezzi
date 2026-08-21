import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';

/** Stores loading state: header + 4 skeleton rows. */
export default function StoresLoading() {
  return (
    <div className="flex flex-1 flex-col" aria-busy="true">
      <div className="flex min-h-14 items-center gap-3 border-border border-b border-dashed px-4 pt-safe">
        <Skeleton width="2.75rem" height="2.75rem" className="rounded-control" />
        <Skeleton width="6rem" />
      </div>
      <div className="mx-auto w-full max-w-3xl pt-2">
        <SkeletonRows count={4} />
      </div>
    </div>
  );
}
