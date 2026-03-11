/**
 * UploadViewer - Backward-compat redirect for /upload/:sessionId -> /video/:sessionId
 * VideoPage at /video/:sessionId is the canonical player for uploaded videos.
 */

import { useParams, Navigate } from 'react-router-dom';

export function UploadViewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <Navigate to={`/video/${sessionId ?? ''}`} replace />;
}
