import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';

/** Timeline loading state: filter row + two day groups. */
export default function HistoryLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col pt-safe" aria-busy="true">
      <div className="flex flex-col gap-3 border-border border-b border-dashed px-4 pt-4 pb-3">
        <Skeleton width="6rem" height="0.75rem" />
        <div className="flex gap-2">
          <Skeleton shape="block" width="6rem" height="2.75rem" className="rounded-full" />
          <Skeleton shape="block" width="5rem" height="2.75rem" className="rounded-full" />
          <Skeleton shape="block" width="6rem" height="2.75rem" className="rounded-full" />
        </div>
      </div>
      {[0, 1].map((group) => (
        <div key={group} className="flex flex-col gap-2 pt-4">
          <div className="px-4">
            <Skeleton width="5rem" height="0.75rem" />
          </div>
          <SkeletonRows count={4} />
        </div>
      ))}
    </div>
  );
}
