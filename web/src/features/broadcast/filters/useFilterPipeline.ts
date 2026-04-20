/**
 * useFilterPipeline — intercepts a raw camera MediaStream and returns a
 * wrapped MediaStream with color/tone filters AND an optional background
 * effect (blur) applied.
 *
 * Pipeline (per RAF tick):
 *   raw MediaStream (camera)
 *   → hidden <video> element playing the raw stream
 *   → depending on backgroundMode:
 *        'none': draw video → output canvas (with ctx.filter = preset.cssFilter)
 *        'blur': segment person, composite blurred bg + sharp person
 *   → canvas.captureStream(30) → filtered MediaStream
 *
 * Filter + background switches are ref-driven, so there's no broadcast
 * glitch when the user taps a preset.
 */

import { useCallback, useRef, useState } from 'react';
import { DEFAULT_FILTER, type FilterPreset } from './presets';
import { PersonSegmenter } from './segmenter';
import { FaceTracker } from './face-landmarker';
import { getSpriteById } from './face-sprites';

export type BackgroundMode = 'none' | 'blur' | 'image';

/** Built-in background images for the 'image' mode. URLs are pulled from
 *  a free stock source (Unsplash) — hosts can add their own later by
 *  extending this list. */
export const BACKGROUND_IMAGES: { id: string; label: string; url: string }[] = [
  { id: 'office', label: 'Office', url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1280&q=80' },
  { id: 'beach',  label: 'Beach',  url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1280&q=80' },
  { id: 'forest', label: 'Forest', url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1280&q=80' },
  { id: 'city',   label: 'City',   url: 'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=1280&q=80' },
];

interface ActivePipeline {
  video: HTMLVideoElement;
  outputCanvas: HTMLCanvasElement;
  bgCanvas: HTMLCanvasElement;
  personCanvas: HTMLCanvasElement;
  rafId: number;
  stream: MediaStream;
  segmenter: PersonSegmenter;
  faceTracker: FaceTracker;
  startTimeMs: number;
}

export function useFilterPipeline() {
  const [currentFilter, setCurrentFilter] = useState<FilterPreset>(DEFAULT_FILTER);
  const [backgroundMode, setBackgroundModeState] = useState<BackgroundMode>('none');
  const [backgroundImageUrl, setBackgroundImageUrlState] = useState<string | null>(null);
  const [faceSpriteId, setFaceSpriteIdState] = useState<string | null>(null);
  const filterRef = useRef<FilterPreset>(DEFAULT_FILTER);
  const backgroundRef = useRef<BackgroundMode>('none');
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const faceSpriteRef = useRef<string | null>(null);
  const pipelineRef = useRef<ActivePipeline | null>(null);

  const setBackgroundImageUrl = useCallback((url: string | null) => {
    setBackgroundImageUrlState(url);
    if (!url) {
      backgroundImageRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { backgroundImageRef.current = img; };
    img.src = url;
  }, []);

  const setFilter = useCallback((preset: FilterPreset) => {
    filterRef.current = preset;
    setCurrentFilter(preset);
  }, []);

  const setBackgroundMode = useCallback((mode: BackgroundMode) => {
    backgroundRef.current = mode;
    setBackgroundModeState(mode);
    if (mode === 'blur' || mode === 'image') {
      pipelineRef.current?.segmenter.warmup();
    }
  }, []);

  const setFaceSpriteId = useCallback((id: string | null) => {
    faceSpriteRef.current = id;
    setFaceSpriteIdState(id);
    if (id) {
      pipelineRef.current?.faceTracker.warmup();
    }
  }, []);

  const wrapVideoStream = useCallback((rawStream: MediaStream): MediaStream => {
    stop();

    const videoTrack = rawStream.getVideoTracks()[0];
    const settings = videoTrack.getSettings();
    const width = settings.width ?? 1280;
    const height = settings.height ?? 720;

    const video = document.createElement('video');
    video.srcObject = new MediaStream([videoTrack]);
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    void video.play().catch(() => {});

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = width;
    outputCanvas.height = height;
    const outputCtx = outputCanvas.getContext('2d');

    // Auxiliary canvases for the blur pipeline. Allocated up front so we
    // don't churn on every frame; widths tracked to handle track resizes.
    const bgCanvas = document.createElement('canvas');
    const personCanvas = document.createElement('canvas');
    bgCanvas.width = personCanvas.width = width;
    bgCanvas.height = personCanvas.height = height;

    const segmenter = new PersonSegmenter();
    const faceTracker = new FaceTracker();

    if (!outputCtx) {
      return new MediaStream([videoTrack]);
    }

    const startTimeMs = performance.now();
    let rafId = 0;
    const draw = () => {
      rafId = requestAnimationFrame(draw);
      if (video.readyState < 2) return;

      const w = outputCanvas.width;
      const h = outputCanvas.height;

      if (backgroundRef.current === 'blur' || backgroundRef.current === 'image') {
        const ts = performance.now() - startTimeMs;
        const maskCanvas = segmenter.segment(video, ts);

        if (!maskCanvas) {
          outputCtx.filter = filterRef.current.cssFilter;
          outputCtx.drawImage(video, 0, 0, w, h);
          return;
        }

        // Background layer: either blurred version of frame or a user-chosen image.
        const bgCtx = bgCanvas.getContext('2d');
        if (bgCtx) {
          if (backgroundRef.current === 'image' && backgroundImageRef.current) {
            // cover-fit the image into the canvas
            const img = backgroundImageRef.current;
            const s = Math.max(w / img.width, h / img.height);
            const dw = img.width * s;
            const dh = img.height * s;
            bgCtx.filter = 'none';
            bgCtx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
          } else {
            bgCtx.filter = 'blur(14px)';
            bgCtx.drawImage(video, 0, 0, w, h);
            bgCtx.filter = 'none';
          }
        }

        // Person cutout: filtered frame masked to person silhouette.
        const personCtx = personCanvas.getContext('2d');
        if (personCtx) {
          personCtx.globalCompositeOperation = 'source-over';
          personCtx.filter = filterRef.current.cssFilter;
          personCtx.drawImage(video, 0, 0, w, h);
          personCtx.filter = 'none';
          personCtx.globalCompositeOperation = 'destination-in';
          personCtx.drawImage(maskCanvas, 0, 0, w, h);
          personCtx.globalCompositeOperation = 'source-over';
        }

        outputCtx.filter = 'none';
        outputCtx.drawImage(bgCanvas, 0, 0, w, h);
        outputCtx.drawImage(personCanvas, 0, 0, w, h);
      } else {
        outputCtx.filter = filterRef.current.cssFilter;
        outputCtx.drawImage(video, 0, 0, w, h);
      }

      // Face sprites — rendered last, on top of everything else. Runs only
      // when a sprite is selected so the Landmarker isn't invoked for users
      // who don't touch the feature.
      const spriteId = faceSpriteRef.current;
      if (spriteId) {
        const sprite = getSpriteById(spriteId);
        if (sprite) {
          const ts = performance.now() - startTimeMs;
          const landmarks = faceTracker.detect(video, ts);
          if (landmarks) {
            outputCtx.filter = 'none';
            sprite.render(outputCtx, landmarks, w, h);
          }
        }
      }
    };
    rafId = requestAnimationFrame(draw);

    const outStream = (outputCanvas as any).captureStream
      ? (outputCanvas as HTMLCanvasElement).captureStream(30)
      : new MediaStream([videoTrack]);

    pipelineRef.current = { video, outputCanvas, bgCanvas, personCanvas, rafId, stream: outStream, segmenter, faceTracker, startTimeMs };
    return outStream;
  }, []);

  const stop = useCallback(() => {
    const p = pipelineRef.current;
    if (!p) return;
    cancelAnimationFrame(p.rafId);
    try { p.video.pause(); } catch {}
    p.video.srcObject = null;
    p.segmenter.close();
    p.faceTracker.close();
    p.stream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    pipelineRef.current = null;
  }, []);

  return {
    currentFilter, setFilter,
    backgroundMode, setBackgroundMode,
    backgroundImageUrl, setBackgroundImageUrl,
    faceSpriteId, setFaceSpriteId,
    wrapVideoStream, stop,
  };
}
