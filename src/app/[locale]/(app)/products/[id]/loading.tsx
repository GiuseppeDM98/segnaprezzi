import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';

/** Product detail loading state: header, chart, 4 tiles, rows. */
export default function ProductDetailLoading() {
  return (
    <div className="flex flex-1 flex-col" aria-busy="true">
      <div className="flex min-h-14 items-center gap-3 border-border border-b border-dashed px-4 pt-safe">
        <Skeleton shape="circle" width="2.75rem" height="2.75rem" className="rounded-control" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton width="60%" />
          <Skeleton width="35%" height="0.625rem" />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-4">
        <div className="flex flex-col gap-3">
          <Skeleton width="7rem" height="0.75rem" />
          <Skeleton shape="block" height="12.5rem" />
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-border bg-border tablet:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex flex-col gap-2 bg-surface px-3 py-3">
              <Skeleton width="2.5rem" height="0.625rem" />
              <Skeleton width="5rem" height="1.125rem" />
              <Skeleton width="4rem" height="0.625rem" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton width="6rem" height="0.75rem" />
          <SkeletonRows count={5} />
        </div>
      </div>
    </div>
  );
}
