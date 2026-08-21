'use client';

/**
 * The tag-shaped overlay on the viewfinder (Spec 03 §3.2).
 *
 * Purely visual — nothing is cropped in v1. Its job is to get the tag close
 * to the centre of the frame at a readable size, which is what keeps the
 * extraction confident. The 2:1 aspect matches Italian shelf tags, which are
 * wide and short.
 */
import { useTranslations } from 'next-intl';

export function FramingGuide() {
  const t = useTranslations('scan');

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
      {/* The scrim is painted as an enormous outward shadow so the cut-out
          stays perfectly aligned with the border, with no second element. */}
      <div
        aria-hidden="true"
        className="aspect-[2/1] w-[85%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
      />
      <p className="px-6 text-center font-medium text-sm text-white drop-shadow">
        {t('camera.frameHint')}
      </p>
    </div>
  );
}
