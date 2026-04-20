/**
 * Face sprite renderers — canvas-primitive drawings that position themselves
 * using normalized face landmarks. We draw with native 2D primitives (paths
 * + fills) rather than loading PNG assets so the feature works offline with
 * zero asset pipeline. Swap each renderer's body for `ctx.drawImage(png)` to
 * upgrade to richer art later.
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { LANDMARK } from './face-landmarker';

export interface FaceSprite {
  id: string;
  label: string;
  render: (ctx: CanvasRenderingContext2D, landmarks: NormalizedLandmark[], w: number, h: number) => void;
}

function px(l: NormalizedLandmark, w: number, h: number) {
  return { x: l.x * w, y: l.y * h };
}

/** Estimate face "size" as distance between cheeks — used to scale sprites. */
function faceWidth(landmarks: NormalizedLandmark[], w: number, h: number) {
  const l = px(landmarks[LANDMARK.LEFT_CHEEK], w, h);
  const r = px(landmarks[LANDMARK.RIGHT_CHEEK], w, h);
  return Math.hypot(r.x - l.x, r.y - l.y);
}

/** Rotation in radians of the face (from cheek line). */
function faceRotation(landmarks: NormalizedLandmark[], w: number, h: number) {
  const l = px(landmarks[LANDMARK.LEFT_CHEEK], w, h);
  const r = px(landmarks[LANDMARK.RIGHT_CHEEK], w, h);
  return Math.atan2(r.y - l.y, r.x - l.x);
}

const dogEars: FaceSprite = {
  id: 'dog-ears',
  label: '🐶 Dog Ears',
  render: (ctx, lms, w, h) => {
    const top = px(lms[LANDMARK.FOREHEAD_TOP], w, h);
    const width = faceWidth(lms, w, h);
    const rot = faceRotation(lms, w, h);
    const earSize = width * 0.35;

    ctx.save();
    ctx.translate(top.x, top.y);
    ctx.rotate(rot);

    // Left ear (drooping triangle with inner pink)
    ctx.fillStyle = '#8B4513';
    ctx.beginPath();
    ctx.moveTo(-width * 0.55, -earSize * 0.2);
    ctx.lineTo(-width * 0.35, -earSize * 1.2);
    ctx.lineTo(-width * 0.15, -earSize * 0.3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#F8B0C0';
    ctx.beginPath();
    ctx.moveTo(-width * 0.42, -earSize * 0.35);
    ctx.lineTo(-width * 0.32, -earSize * 0.95);
    ctx.lineTo(-width * 0.22, -earSize * 0.4);
    ctx.closePath();
    ctx.fill();

    // Right ear
    ctx.fillStyle = '#8B4513';
    ctx.beginPath();
    ctx.moveTo(width * 0.15, -earSize * 0.3);
    ctx.lineTo(width * 0.35, -earSize * 1.2);
    ctx.lineTo(width * 0.55, -earSize * 0.2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#F8B0C0';
    ctx.beginPath();
    ctx.moveTo(width * 0.22, -earSize * 0.4);
    ctx.lineTo(width * 0.32, -earSize * 0.95);
    ctx.lineTo(width * 0.42, -earSize * 0.35);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  },
};

const sunglasses: FaceSprite = {
  id: 'sunglasses',
  label: '🕶️ Sunglasses',
  render: (ctx, lms, w, h) => {
    const leftOuter = px(lms[LANDMARK.LEFT_EYE_OUTER], w, h);
    const rightOuter = px(lms[LANDMARK.RIGHT_EYE_OUTER], w, h);
    const mid = { x: (leftOuter.x + rightOuter.x) / 2, y: (leftOuter.y + rightOuter.y) / 2 };
    const width = Math.hypot(rightOuter.x - leftOuter.x, rightOuter.y - leftOuter.y);
    const rot = Math.atan2(rightOuter.y - leftOuter.y, rightOuter.x - leftOuter.x);
    const lensR = width * 0.25;
    const lensSep = width * 0.55;

    ctx.save();
    ctx.translate(mid.x, mid.y);
    ctx.rotate(rot);
    ctx.fillStyle = 'rgba(10,10,10,0.92)';
    // Left lens
    ctx.beginPath();
    ctx.ellipse(-lensSep / 2, 0, lensR, lensR * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    // Right lens
    ctx.beginPath();
    ctx.ellipse(lensSep / 2, 0, lensR, lensR * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    // Bridge
    ctx.fillRect(-lensSep / 2 + lensR * 0.6, -lensR * 0.08, lensSep - lensR * 1.2, lensR * 0.16);
    // Highlight glint
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.ellipse(-lensSep / 2 - lensR * 0.35, -lensR * 0.35, lensR * 0.25, lensR * 0.15, 0, 0, Math.PI * 2);
    ctx.ellipse(lensSep / 2 - lensR * 0.35, -lensR * 0.35, lensR * 0.25, lensR * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
};

const mustache: FaceSprite = {
  id: 'mustache',
  label: '🥸 Mustache',
  render: (ctx, lms, w, h) => {
    const nose = px(lms[LANDMARK.NOSE_TIP], w, h);
    const upper = px(lms[LANDMARK.UPPER_LIP_TOP], w, h);
    const width = faceWidth(lms, w, h);
    const rot = faceRotation(lms, w, h);
    const cx = (nose.x + upper.x) / 2;
    const cy = (nose.y + upper.y * 2) / 3;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.fillStyle = '#2a1a0a';
    ctx.beginPath();
    // Classic handlebar-ish curve
    const ww = width * 0.45;
    const hh = width * 0.08;
    ctx.moveTo(-ww, 0);
    ctx.quadraticCurveTo(-ww * 0.8, -hh * 2, -ww * 0.3, -hh * 0.6);
    ctx.quadraticCurveTo(0, hh * 0.2, ww * 0.3, -hh * 0.6);
    ctx.quadraticCurveTo(ww * 0.8, -hh * 2, ww, 0);
    ctx.quadraticCurveTo(ww * 0.6, hh * 1.5, 0, hh * 1.4);
    ctx.quadraticCurveTo(-ww * 0.6, hh * 1.5, -ww, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },
};

export const FACE_SPRITES: FaceSprite[] = [dogEars, sunglasses, mustache];

export function getSpriteById(id: string | null | undefined): FaceSprite | null {
  if (!id) return null;
  return FACE_SPRITES.find((s) => s.id === id) ?? null;
}
