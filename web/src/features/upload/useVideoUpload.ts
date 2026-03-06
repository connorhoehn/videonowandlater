import { useState, useCallback, useRef } from 'react';
import { getConfig } from '../../config/aws-config';

const CHUNK_SIZE = 52 * 1024 * 1024; // 52MB chunks

interface InitUploadResponse {
  sessionId: string;
  uploadId: string;
  maxChunkSize: number;
  expiresIn: number;
}

interface PartUrlResponse {
  presignedUrl: string;
  expiresIn: number;
}

interface CompleteUploadResponse {
  sessionId: string;
  uploadStatus: string;
}

interface PartETag {
  partNumber: number;
  eTag: string;
}

export const useVideoUpload = (authToken: string | null) => {
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startUpload = useCallback(
    async (file: File): Promise<string | null> => {
      if (!authToken) {
        setError('Authentication required');
        return null;
      }

      setIsUploading(true);
      setError(null);
      setUploadProgress(0);
      abortControllerRef.current = new AbortController();

      try {
        const apiUrl = getConfig()?.apiUrl;
        if (!apiUrl) {
          throw new Error('API URL not configured');
        }

        // Step 1: Initialize upload
        const initResponse = await fetch(`${apiUrl}/upload/init`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filename: file.name,
            filesize: file.size,
            mimeType: file.type,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!initResponse.ok) {
          throw new Error(`Upload init failed: ${initResponse.status}`);
        }

        const initData: InitUploadResponse = await initResponse.json();
        const { sessionId, uploadId } = initData;

        // Step 2: Calculate chunks
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const partETags: PartETag[] = [];

        // Step 3: Upload each chunk
        for (let partNumber = 1; partNumber <= totalChunks; partNumber++) {
          if (abortControllerRef.current?.signal.aborted) {
            throw new Error('Upload cancelled');
          }

          const start = (partNumber - 1) * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);

          // Get presigned URL for this chunk (with retry on 403)
          let presignedUrl: string | undefined;
          let retries = 0;
          while (retries < 3) {
            try {
              const partUrlResponse = await fetch(`${apiUrl}/upload/part-url`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${authToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sessionId, uploadId, partNumber }),
                signal: abortControllerRef.current.signal,
              });

              if (partUrlResponse.status === 403) {
                retries++;
                if (retries >= 3) {
                  throw new Error(`Presigned URL expired and could not be renewed (part ${partNumber})`);
                }
                // Wait before retrying
                await new Promise((resolve) => setTimeout(resolve, 1000));
                continue;
              }

              if (!partUrlResponse.ok) {
                throw new Error(`Failed to get presigned URL: ${partUrlResponse.status}`);
              }

              const partUrlData: PartUrlResponse = await partUrlResponse.json();
              presignedUrl = partUrlData.presignedUrl;
              break;
            } catch (err) {
              if (err instanceof Error && err.message.includes('Presigned URL expired')) {
                throw err;
              }
              retries++;
              if (retries >= 3) {
                throw err;
              }
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }

          if (!presignedUrl) {
            throw new Error(`Failed to obtain presigned URL for part ${partNumber}`);
          }

          // Upload chunk to S3 with presigned URL
          const uploadResponse = await fetch(presignedUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: chunk,
            signal: abortControllerRef.current.signal,
          });

          if (!uploadResponse.ok) {
            throw new Error(`S3 upload failed: ${uploadResponse.status}`);
          }

          // Extract ETag from response headers
          const eTag = uploadResponse.headers.get('etag');
          if (!eTag) {
            throw new Error(`Missing ETag in S3 response for part ${partNumber}`);
          }

          partETags.push({ partNumber, eTag });

          // Update progress
          setUploadProgress(Math.round((partNumber / totalChunks) * 100));
        }

        // Step 4: Complete multipart upload
        const completeResponse = await fetch(`${apiUrl}/upload/complete`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sessionId, uploadId, partETags }),
          signal: abortControllerRef.current.signal,
        });

        if (!completeResponse.ok) {
          throw new Error(`Upload complete failed: ${completeResponse.status}`);
        }

        const completeData: CompleteUploadResponse = await completeResponse.json();

        setUploadProgress(100);
        setIsUploading(false);
        return completeData.sessionId;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Upload failed';

        setError(errorMessage);
        setIsUploading(false);
        return null;
      }
    },
    [authToken]
  );

  const cancelUpload = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsUploading(false);
    setError('Upload cancelled');
  }, []);

  return {
    uploadProgress,
    isUploading,
    error,
    startUpload,
    cancelUpload,
  };
};
