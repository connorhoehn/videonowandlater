/**
 * MediaPipe Face Landmarker wrapper. 468 per-face landmarks at ~30fps on
 * desktop GPU. Lazy-initialized like the segmenter so the ~3 MB WASM+model
 * download doesn't hit broadcasters who never enable a face filter.
 *
 * Returns normalized landmarks (x/y in [0, 1] relative to the source image)
 * which the pipeline converts to canvas pixel coordinates at draw time.
 */

import { FilesetResolver, FaceLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

async function loadLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
    })().catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

/** MediaPipe Face Mesh landmark indices we care about. */
export const LANDMARK = {
  FOREHEAD_TOP: 10,
  CHIN: 152,
  NOSE_TIP: 1,
  LEFT_EYE_OUTER: 33,
  LEFT_EYE_INNER: 133,
  RIGHT_EYE_INNER: 362,
  RIGHT_EYE_OUTER: 263,
  LEFT_CHEEK: 234,
  RIGHT_CHEEK: 454,
  UPPER_LIP_TOP: 0,
  LOWER_LIP_BOTTOM: 17,
} as const;

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private lastLandmarks: NormalizedLandmark[] | null = null;

  warmup(): Promise<void> {
    return loadLandmarker().then(() => undefined).catch(() => undefined);
  }

  /**
   * Run landmark detection on the current video frame. Returns normalized
   * landmarks or null if no face detected / model not ready.
   */
  detect(video: HTMLVideoElement, timestampMs: number): NormalizedLandmark[] | null {
    if (!this.landmarker) {
      loadLandmarker().then((l) => { this.landmarker = l; }).catch(() => {});
      return null;
    }
    try {
      const result = this.landmarker.detectForVideo(video, timestampMs);
      const faces = result.faceLandmarks;
      if (faces && faces.length > 0) {
        this.lastLandmarks = faces[0];
        return this.lastLandmarks;
      }
      return null;
    } catch {
      return null;
    }
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
    landmarkerPromise = null;
  }
}
