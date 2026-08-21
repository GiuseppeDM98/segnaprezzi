'use client';

/**
 * The tag-shaped overlay on the viewfinder (Spec 03 §3.2, Spec 05 §5.2).
 *
 * Purely visual — nothing is cropped in v1. Its job is to get the tag close
 * to the centre of the frame at a readable size, which is what keeps the
 * extraction confident. The 2:1 aspect matches Italian shelf tags, which
 * are wide and short. Corner marks only: a full frame would compete with
 * the tag's own printed border. The hint fades after the first capture.
 */
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';

import { useAppMotion } from '@/lib/motion';

export interface FramingGuideProps {
  isHintVisible: boolean;
}

export function FramingGuide({ isHintVisible }: FramingGuideProps) {
  const t = useTranslations('scan');
  const { fade } = useAppMotion();

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4">
      <div aria-hidden="true" className="relative aspect-[2/1] w-[84%] max-w-md">
        {/* Four corner marks, drawn with borders so they scale with the box. */}
        <span className="absolute top-0 left-0 size-7 rounded-tl-lg border-camera-contrast/90 border-t-[3px] border-l-[3px]" />
        <span className="absolute top-0 right-0 size-7 rounded-tr-lg border-camera-contrast/90 border-t-[3px] border-r-[3px]" />
        <span className="absolute bottom-0 left-0 size-7 rounded-bl-lg border-camera-contrast/90 border-b-[3px] border-l-[3px]" />
        <span className="absolute right-0 bottom-0 size-7 rounded-br-lg border-camera-contrast/90 border-r-[3px] border-b-[3px]" />
      </div>
      <AnimatePresence>
        {isHintVisible && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
            className="rounded-full bg-camera/50 px-3.5 py-1.5 font-sans font-medium text-[14px] text-camera-contrast"
          >
            {t('camera.frameHint')}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
