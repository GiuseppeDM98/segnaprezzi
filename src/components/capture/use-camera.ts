'use client';

/**
 * getUserMedia lifecycle for the in-app viewfinder (Spec 03 §3.1).
 *
 * Design: the shutter must feel instant, so this hook keeps a live stream
 * open and captures a raw JPEG frame synchronously from the video element;
 * the expensive WebP compression happens afterwards in compressPhoto (§4).
 * The stream is released whenever the tab is hidden — a live camera in a
 * background tab drains a phone battery fast — and re-acquired on return.
 */
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

export type CameraState = 'idle' | 'requesting' | 'streaming' | 'denied' | 'unavailable';

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    // 'ideal', not 'exact': 'exact' throws OverconstrainedError on laptops
    // and front-camera-only devices instead of falling back gracefully.
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

/** Quality of the intermediate JPEG frame; compressPhoto re-encodes it anyway. */
const CAPTURE_QUALITY = 0.92;

export interface UseCameraResult {
  state: CameraState;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Grab the current frame, or null when the stream is not ready. */
  capturePhoto: () => Promise<Blob | null>;
  /** Re-run getUserMedia after the user changed the permission. */
  retryPermission: () => void;
}

export function useCamera(): UseCameraResult {
  const [state, setState] = useState<CameraState>('idle');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // getUserMedia resolves asynchronously; without this guard a permission
  // prompt answered after navigation would attach a live camera to a
  // destroyed component and leave the device light on.
  const isMountedRef = useRef(true);

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const acquireStream = useCallback(async (): Promise<void> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      return;
    }

    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      if (!isMountedRef.current) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setState('streaming');
    } catch (error) {
      if (isMountedRef.current) {
        setState(toCameraState(error));
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    function handleVisibilityChange(): void {
      if (document.visibilityState === 'hidden') {
        stopStream();
      } else {
        void acquireStream();
      }
    }

    void acquireStream();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopStream();
    };
  }, [acquireStream, stopStream]);

  const capturePhoto = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', CAPTURE_QUALITY);
    });
  }, []);

  const retryPermission = useCallback(() => {
    void acquireStream();
  }, [acquireStream]);

  return { state, videoRef, capturePhoto, retryPermission };
}

/**
 * Distinguish "the user said no" from "there is no camera here".
 * The two need different UI: a retry button versus the file-input fallback.
 */
function toCameraState(error: unknown): CameraState {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'denied';
  }
  return 'unavailable';
}
