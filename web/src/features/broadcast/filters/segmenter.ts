/**
 * MediaPipe Selfie Segmentation wrapper. Lazy-initialized singleton — the
 * WASM + model download (~2 MB) is deferred until the user actually enables
 * a background effect, so it doesn't impact cold-start for broadcasters who
 * never touch the feature.
 *
 * Returns a canvas whose alpha channel encodes the person mask (opaque on
 * foreground pixels, transparent on background) so it can be used with
 * `globalCompositeOperation = 'destination-in'` to cut a person silhouette
 * out of any source image.
 */

import { FilesetResolver, ImageSegmenter, type MPMask } from '@mediapipe/tasks-vision';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';

let segmenterPromise: Promise<ImageSegmenter> | null = null;

async function loadSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      return ImageSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
    })().catch((err) => {
      segmenterPromise = null;
      throw err;
    });
  }
  return segmenterPromise;
}

export class PersonSegmenter {
  private segmenter: ImageSegmenter | null = null;
  private maskCanvas: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D | null;
  private imageData: ImageData | null = null;

  constructor() {
    this.maskCanvas = document.createElement('canvas');
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
  }

  /** Kick off model load without blocking. */
  warmup(): Promise<void> {
    return loadSegmenter().then(() => undefined).catch(() => undefined);
  }

  /**
   * Run segmentation on the current video frame. Returns a canvas whose
   * pixels are opaque white where the person is, transparent elsewhere.
   * Returns null if the segmenter isn't ready yet (caller should fall back
   * to drawing the raw frame with no background effect).
   */
  segment(video: HTMLVideoElement, timestampMs: number): HTMLCanvasElement | null {
    if (!this.segmenter) {
      // Kick off load once; subsequent frames will use the cached instance.
      loadSegmenter().then((s) => { this.segmenter = s; }).catch(() => { /* already logged */ });
      return null;
    }

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;

    if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
      this.maskCanvas.width = w;
      this.maskCanvas.height = h;
      this.imageData = null;
    }
    if (!this.maskCtx) return null;

    let mpMask: MPMask | undefined;
    try {
      const result = this.segmenter.segmentForVideo(video, timestampMs);
      mpMask = result.categoryMask;
      if (!mpMask) return null;

      // MPMask has a .getAsUint8Array() returning category indices (0=bg, 1=person)
      const categories = mpMask.getAsUint8Array();
      if (!this.imageData || this.imageData.width !== w || this.imageData.height !== h) {
        this.imageData = this.maskCtx.createImageData(w, h);
      }
      const data = this.imageData.data;
      // Person pixels → opaque white; background → transparent.
      for (let i = 0, j = 0; i < categories.length; i++, j += 4) {
        const isPerson = categories[i] > 0;
        data[j] = 255;
        data[j + 1] = 255;
        data[j + 2] = 255;
        data[j + 3] = isPerson ? 255 : 0;
      }
      this.maskCtx.putImageData(this.imageData, 0, 0);
      return this.maskCanvas;
    } finally {
      mpMask?.close();
    }
  }

  close() {
    this.segmenter?.close();
    this.segmenter = null;
    segmenterPromise = null;
  }
}
