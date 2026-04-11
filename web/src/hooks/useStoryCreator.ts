import { useState, useCallback } from 'react';
import { getConfig } from '../config/aws-config';
import { fetchToken } from '../auth/fetchToken';

interface UploadingSegment {
  file: File;
  progress: number; // 0-100
  status: 'pending' | 'uploading' | 'done' | 'error';
  segmentId?: string;
  localId: string;
}

interface UseStoryCreatorReturn {
  sessionId: string | null;
  segments: UploadingSegment[];
  creating: boolean;
  publishing: boolean;
  error: string | null;
  startStory: () => Promise<void>;
  addFiles: (files: File[]) => Promise<void>;
  removeSegment: (index: number) => void;
  publish: () => Promise<boolean>;
  reset: () => void;
}

export function useStoryCreator(): UseStoryCreatorReturn {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [segments, setSegments] = useState<UploadingSegment[]>([]);
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startStory = useCallback(async () => {
    const config = getConfig();
    if (!config?.apiUrl) return;
    setCreating(true);
    setError(null);
    try {
      const { token } = await fetchToken();
      const res = await fetch(`${config.apiUrl}/stories`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error(`Failed to create story: ${res.status}`);
      const data = await res.json();
      setSessionId(data.sessionId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }, []);

  const addFiles = useCallback(async (files: File[]) => {
    if (!sessionId) return;
    const config = getConfig();
    if (!config?.apiUrl) return;

    for (const file of files) {
      const type = file.type.startsWith('video/') ? 'video' : 'image';
      const localId = crypto.randomUUID();

      setSegments(prev => [...prev, { file, progress: 0, status: 'pending', localId }]);

      try {
        const { token } = await fetchToken();
        // Get presigned URL
        const segRes = await fetch(`${config.apiUrl}/stories/${sessionId}/segments`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, filename: file.name, contentType: file.type }),
        });
        if (!segRes.ok) throw new Error(`Failed to add segment: ${segRes.status}`);
        const { segmentId, uploadUrl } = await segRes.json();

        // Upload to S3 via presigned URL
        setSegments(prev => prev.map(s => s.localId === localId ? { ...s, status: 'uploading' as const } : s));

        const uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!uploadRes.ok) throw new Error('Upload failed');

        setSegments(prev => prev.map(s => s.localId === localId ? { ...s, status: 'done' as const, progress: 100, segmentId } : s));
      } catch (err: any) {
        setSegments(prev => prev.map(s => s.localId === localId ? { ...s, status: 'error' as const } : s));
        setError(err.message);
      }
    }
  }, [sessionId]);

  const removeSegment = useCallback((index: number) => {
    setSegments(prev => prev.filter((_, i) => i !== index));
  }, []);

  const publish = useCallback(async (): Promise<boolean> => {
    if (!sessionId) return false;
    const config = getConfig();
    if (!config?.apiUrl) return false;
    setPublishing(true);
    try {
      const { token } = await fetchToken();
      const res = await fetch(`${config.apiUrl}/stories/${sessionId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Publish failed: ${res.status}`);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setPublishing(false);
    }
  }, [sessionId]);

  const reset = useCallback(() => {
    setSessionId(null);
    setSegments([]);
    setError(null);
    setCreating(false);
    setPublishing(false);
  }, []);

  return { sessionId, segments, creating, publishing, error, startStory, addFiles, removeSegment, publish, reset };
}
