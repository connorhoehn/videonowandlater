/**
 * MediaPipe Selfie Segmentation wrapper.
 *
 * Uses CONFIDENCE mask (Float32Array of per-pixel probabilities 0.0–1.0)
 * instead of the binary category mask — yields soft edges with no polarity
 * ambiguity, and the alpha channel can encode probability directly so
 * composites look natural against any background.
 *
 * Output: an HTMLCanvasElement whose alpha channel = segmentation confidence
 * (255 = definite person, 0 = definite background, smooth gradient at edges).
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
        // Confidence mask gives soft alpha; category would be binary/blocky.
        outputCategoryMask: false,
        outputConfidenceMasks: true,
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

  warmup(): Promise<void> {
    return loadSegmenter().then(() => undefined).catch(() => undefined);
  }

  /**
   * Run segmentation on the current video frame. Returns a canvas whose
   * alpha encodes per-pixel person probability. Null until model loads.
   */
  segment(video: HTMLVideoElement, timestampMs: number): HTMLCanvasElement | null {
    if (!this.segmenter) {
      loadSegmenter().then((s) => { this.segmenter = s; }).catch(() => {});
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
      // Selfie Segmenter returns exactly one confidence mask (index 0 = person)
      mpMask = result.confidenceMasks?.[0];
      if (!mpMask) return null;

      const probs = mpMask.getAsFloat32Array();
      if (!this.imageData || this.imageData.width !== w || this.imageData.height !== h) {
        this.imageData = this.maskCtx.createImageData(w, h);
      }
      const data = this.imageData.data;

      // Alpha = confidence * 255. Apply a small threshold curve to sharpen
      // the edge around 0.5 so low-confidence spray doesn't leak through,
      // but keep feathering for a natural silhouette.
      //   curve(p) = clamp(1.8 * p - 0.4, 0, 1)  → 0 below 0.22, 1 above 0.78
      for (let i = 0, j = 0; i < probs.length; i++, j += 4) {
        const p = probs[i];
        const shaped = Math.max(0, Math.min(1, 1.8 * p - 0.4));
        data[j] = 255;
        data[j + 1] = 255;
        data[j + 2] = 255;
        data[j + 3] = (shaped * 255) | 0;
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
