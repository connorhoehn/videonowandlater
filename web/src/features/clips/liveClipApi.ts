/**
 * liveClipApi — thin fetch wrapper around the live-clip endpoints.
 *
 * Both calls require a Cognito bearer token (the caller is expected to have
 * one already — this module does not refresh tokens).
 *
 * Endpoints:
 *   POST /sessions/{id}/clips/live  → createLiveClip
 *   GET  /me/clips                  → listMyClips
 */

import { getConfig } from '../../config/aws-config';
import type { Clip } from './types';

function apiBaseUrl(): string {
  return getConfig()?.apiUrl || '';
}

export interface CreateLiveClipResponse {
  clipId: string;
  status: 'pending';
}

export class LiveClipApiError extends Error {
  constructor(public status: number, public body: unknown, message?: string) {
    super(message ?? `LiveClipApi request failed: ${status}`);
    this.name = 'LiveClipApiError';
  }
}

async function parseError(res: Response): Promise<LiveClipApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* response had no JSON body */
  }
  const message =
    body && typeof body === 'object' && 'error' in body
      ? String((body as { error: unknown }).error)
      : `HTTP ${res.status}`;
  return new LiveClipApiError(res.status, body, message);
}

/**
 * Request a "clip the last 10 seconds" on a live session.
 * Returns `{ clipId, status: 'pending' }` on success (202).
 */
export async function createLiveClip(
  sessionId: string,
  authToken: string,
): Promise<CreateLiveClipResponse> {
  const res = await fetch(`${apiBaseUrl()}/sessions/${sessionId}/clips/live`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: '{}',
  });
  if (!res.ok) throw await parseError(res);
  const data = (await res.json()) as CreateLiveClipResponse;
  return data;
}

/**
 * List clips authored by the caller (live + post-session), newest first.
 */
export async function listMyClips(authToken: string, limit = 50): Promise<Clip[]> {
  const qs = limit === 50 ? '' : `?limit=${encodeURIComponent(String(limit))}`;
  const res = await fetch(`${apiBaseUrl()}/me/clips${qs}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
  if (!res.ok) throw await parseError(res);
  const data = (await res.json()) as { clips: Clip[] };
  return data.clips ?? [];
}
