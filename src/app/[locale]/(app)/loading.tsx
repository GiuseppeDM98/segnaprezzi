import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';

/**
 * Dashboard loading state: skeletons mirroring the hero
 * number, the chart block, four bar rows and three mover rows.
 */
export default function DashboardLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pt-safe pb-4 tablet:px-8 tablet:pt-6"
      aria-busy="true"
    >
      <div className="pt-4 tablet:pt-0">
        <Skeleton width="9rem" height="0.75rem" />
      </div>
      <div className="grid gap-10 tablet:grid-cols-[2fr_1fr] tablet:gap-x-10">
        <div className="flex flex-col gap-10">
          <div className="flex flex-col gap-4">
            <Skeleton width="12rem" />
            <Skeleton shape="block" width="16rem" height="5.5rem" />
            <SkeletonRows count={3} />
            <Skeleton width="14rem" />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton width="6rem" height="0.75rem" />
            <Skeleton shape="block" height="13.75rem" />
          </div>
        </div>
        <div className="flex flex-col gap-10">
          <div className="flex flex-col gap-3">
            <Skeleton width="7rem" height="0.75rem" />
            <SkeletonRows count={4} />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton width="10rem" height="0.75rem" />
            <SkeletonRows count={3} />
          </div>
        </div>
      </div>
    </div>
  );
}
