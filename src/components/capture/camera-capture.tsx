'use client';

/**
 * The viewfinder screen (Spec 03 §3.2, §3.3).
 *
 * Design: the whole viewfinder is the shutter. In a supermarket aisle the
 * phone is held one-handed, often with a glove or a full cart hand, and
 * hunting for a small button between items is what makes people give up on
 * capturing every tag. The dedicated button stays for discoverability.
 *
 * Every camera failure degrades to the OS file picker rather than to a dead
 * end: the downstream pipeline is identical for a picked image.
 */
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, useRef, useState } from 'react';
import { FramingGuide } from './framing-guide';
import { useCamera } from './use-camera';

/** How long the white confirmation flash stays visible. */
const FLASH_DURATION_MS = 120;

/** Haptic tick on shutter, where the device supports it. */
const SHUTTER_VIBRATION_MS = 40;

export interface CameraCaptureProps {
  /** Receives the raw frame; the caller compresses and enqueues it. */
  onCapture: (source: Blob) => void | Promise<void>;
}

export function CameraCapture({ onCapture }: CameraCaptureProps) {
  const t = useTranslations('scan');
  const { state, videoRef, capturePhoto, retryPermission } = useCamera();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);

  async function handleShutter(): Promise<void> {
    const frame = await capturePhoto();
    if (!frame) {
      return;
    }
    // Feedback fires before the (awaited) handler so the shutter feels
    // instant even while the photo is still being compressed and queued.
    setIsFlashing(true);
    navigator.vibrate?.(SHUTTER_VIBRATION_MS);
    setTimeout(() => setIsFlashing(false), FLASH_DURATION_MS);
    await onCapture(frame);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Reset first: picking the same file twice in a row fires no change event
    // otherwise, and a retake of the same shot is a normal thing to do.
    event.target.value = '';
    if (file) {
      await onCapture(file);
    }
  }

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      capture="environment"
      onChange={handleFileChange}
      className="sr-only"
      data-testid="photo-file-input"
    />
  );

  if (state === 'denied') {
    return (
      <section
        data-testid="camera-fallback"
        className="flex flex-col items-center gap-4 rounded-2xl bg-surface p-6 text-center"
      >
        <h2 className="font-semibold text-lg">{t('camera.permissionDenied.title')}</h2>
        <p className="text-sm text-text-muted">{t('camera.permissionDenied.body')}</p>
        <button
          type="button"
          onClick={retryPermission}
          className="rounded-full bg-accent px-6 py-3 font-medium text-accent-contrast"
        >
          {t('camera.permissionDenied.retry')}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-accent text-sm underline"
        >
          {t('camera.permissionDenied.useLibrary')}
        </button>
        {fileInput}
      </section>
    );
  }

  if (state === 'unavailable') {
    return (
      <section
        data-testid="camera-fallback"
        className="flex flex-col items-center gap-4 rounded-2xl bg-surface p-6 text-center"
      >
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-full bg-accent px-6 py-4 font-medium text-accent-contrast"
        >
          {t('camera.unavailable')}
        </button>
        {fileInput}
      </section>
    );
  }

  return (
    <section className="relative isolate aspect-[3/4] w-full overflow-hidden rounded-2xl bg-black">
      {/* Tapping the viewfinder shoots; the shutter button below is the
          keyboard- and screen-reader-accessible equivalent. */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        onClick={handleShutter}
        className="h-full w-full object-cover"
      />
      <FramingGuide />

      <AnimatePresence>
        {isFlashing && (
          <motion.div
            key="shutter-flash"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.9 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          />
        )}
      </AnimatePresence>

      <div className="absolute inset-x-0 bottom-4 flex justify-center">
        <button
          type="button"
          onClick={handleShutter}
          aria-label={t('camera.shutter')}
          disabled={state !== 'streaming'}
          className="size-16 rounded-full border-4 border-white bg-white/30 disabled:opacity-40"
        />
      </div>
      {fileInput}
    </section>
  );
}
