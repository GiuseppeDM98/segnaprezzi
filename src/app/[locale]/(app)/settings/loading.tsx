import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';

/** Settings loading state: skeleton rows per section. */
export default function SettingsLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 pt-safe pb-6"
      aria-busy="true"
    >
      <div className="pt-4">
        <Skeleton width="7rem" height="0.75rem" />
      </div>
      {[3, 2, 2, 3, 3].map((rows, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder sections
        <div key={index} className="flex flex-col gap-3">
          <Skeleton width="5rem" height="0.75rem" />
          <SkeletonRows count={rows} />
        </div>
      ))}
    </div>
  );
}
