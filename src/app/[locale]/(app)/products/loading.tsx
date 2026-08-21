import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';

/** Catalog loading state (Spec 05 §5.6): header controls + 8 skeleton rows. */
export default function ProductsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col pt-safe" aria-busy="true">
      <div className="flex flex-col gap-3 border-border border-b border-dashed px-4 pt-4 pb-3">
        <Skeleton width="5rem" height="0.75rem" />
        <Skeleton shape="block" height="2.75rem" />
        <div className="flex gap-2">
          <Skeleton shape="block" width="4rem" height="2.75rem" className="rounded-full" />
          <Skeleton shape="block" width="6rem" height="2.75rem" className="rounded-full" />
          <Skeleton shape="block" width="5rem" height="2.75rem" className="rounded-full" />
        </div>
      </div>
      <SkeletonRows count={8} />
    </div>
  );
}
