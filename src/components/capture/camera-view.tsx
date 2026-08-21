'use client';

/**
 * Full-bleed getUserMedia viewfinder (Spec 05 §6.3): framing guide,
 * shutter, torch, permission/failure states and the file-input fallback.
 * The slots (`topBar`, `bottomBar`) let the screen lay its chrome inside
 * the safe-area insets while the video extends behind them.
 *
 * Design: the whole viewfinder is the shutter. In a supermarket aisle the
 * phone is held one-handed, and hunting for a small button is what makes
 * people give up on capturing every tag. The dedicated button stays for
 * discoverability and for keyboard/screen-reader users. Every camera
 * failure degrades to the OS file picker rather than a dead end: the
 * downstream pipeline is identical for a picked image.
 */
import { ImageUp, X, Zap, ZapOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, type ReactNode, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { cx } from '@/lib/cx';
import { useAppMotion } from '@/lib/motion';
import { FramingGuide } from './framing-guide';
import { useCamera } from './use-camera';

/** How long the confirmation flash stays visible. */
const FLASH_DURATION_MS = 120;
/** Haptic tick on shutter, where the device supports it. */
const SHUTTER_VIBRATION_MS = 40;

export interface CameraViewProps {
  /** Receives the raw frame; the caller compresses and enqueues it. */
  onCapture: (source: Blob) => void | Promise<void>;
  /** Leaves the capture screen (also offered by the fallback panels). */
  onClose: () => void;
  /** Rendered inside the top safe area, over the feed. */
  topBar: ReactNode;
  /** Rendered above the shutter (tray, review CTA); told whether it sits on the live feed. */
  bottomBar: (context: { isOnCamera: boolean }) => ReactNode;
  /** Hides the framing hint after the first capture of the session. */
  isHintVisible: boolean;
}

export function CameraView({
  onCapture,
  onClose,
  topBar,
  bottomBar,
  isHintVisible,
}: CameraViewProps) {
  const t = useTranslations('scan');
  const { isReduced, spring, fade } = useAppMotion();
  const {
    state,
    videoRef,
    capturePhoto,
    retryPermission,
    isTorchAvailable,
    isTorchOn,
    toggleTorch,
  } = useCamera();
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
    // Reset first: picking the same file twice in a row fires no change
    // event otherwise, and a retake of the same shot is a normal thing to do.
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
      aria-label={t('camera.permissionDenied.useLibrary')}
      className="sr-only"
      data-testid="photo-file-input"
    />
  );

  const isFallback = state === 'denied' || state === 'unavailable';

  return (
    <div className="relative flex h-dvh flex-col bg-camera text-camera-contrast">
      {/* Live feed (or the fallback panel) fills the whole screen behind the insets. */}
      {isFallback ? (
        <div
          data-testid="camera-fallback"
          className="flex flex-1 flex-col bg-background px-4 pt-safe pb-safe text-text"
        >
          <div className="flex h-14 items-center">
            <IconButton icon={<X />} label={t('close')} onClick={onClose} />
          </div>
          <div className="flex flex-1 flex-col items-center justify-center">
            <EmptyState
              icon={<ImageUp />}
              title={
                state === 'denied' ? t('camera.permissionDenied.title') : t('camera.unavailable')
              }
              body={state === 'denied' ? t('camera.permissionDenied.body') : undefined}
              action={
                <Button onClick={() => fileInputRef.current?.click()} size="lg">
                  {t('camera.permissionDenied.useLibrary')}
                </Button>
              }
              secondaryAction={
                state === 'denied' ? (
                  <Button variant="ghost" onClick={retryPermission}>
                    {t('camera.permissionDenied.retry')}
                  </Button>
                ) : undefined
              }
            />
          </div>
          {/* The tray and the review CTA still apply: picked photos travel the
              same pipeline as captured ones. */}
          <div className="flex flex-col gap-4 pb-2">{bottomBar({ isOnCamera: false })}</div>
          {fileInput}
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            onClick={handleShutter}
            className="absolute inset-0 h-full w-full object-cover"
          />
          {state !== 'streaming' && (
            <div
              aria-live="polite"
              className="absolute inset-0 flex items-center justify-center bg-camera font-mono text-[13px] text-camera-contrast/70"
            >
              {t('camera.starting')}
            </div>
          )}
          <FramingGuide isHintVisible={isHintVisible && state === 'streaming'} />
          <AnimatePresence>
            {isFlashing && (
              <motion.div
                key="shutter-flash"
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-camera-contrast"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.85 }}
                exit={{ opacity: 0 }}
                transition={isReduced ? fade : spring}
              />
            )}
          </AnimatePresence>
          {fileInput}
        </>
      )}

      {/* Chrome sits inside the safe area; the feed runs behind it. */}
      {!isFallback && (
        <>
          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-3 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)]">
            {topBar}
            {isTorchAvailable && (
              <IconButton
                icon={isTorchOn ? <ZapOff /> : <Zap />}
                label={isTorchOn ? t('torchOff') : t('torchOn')}
                onClick={() => void toggleTorch()}
                className={cx(
                  'bg-camera/50 text-camera-contrast hover:bg-camera/70',
                  isTorchOn && 'bg-accent text-accent-contrast',
                )}
              />
            )}
          </div>

          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-4 bg-gradient-to-t from-camera/85 to-camera/0 px-4 pt-10 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
            {bottomBar({ isOnCamera: true })}
            <div className="flex items-center justify-center">
              <motion.button
                type="button"
                onClick={handleShutter}
                aria-label={t('camera.shutter')}
                data-testid="shutter"
                disabled={state !== 'streaming'}
                whileTap={isReduced ? undefined : { scale: 0.92 }}
                className="flex size-[72px] items-center justify-center rounded-full border-4 border-camera-contrast bg-camera-contrast/20 backdrop-blur-sm disabled:opacity-40"
              >
                <span aria-hidden="true" className="size-14 rounded-full bg-camera-contrast" />
              </motion.button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
