import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVideoUpload } from './useVideoUpload';

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB
const SUPPORTED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];

interface VideoUploadFormProps {
  authToken: string | null;
  onClose?: () => void;
}

export const VideoUploadForm: React.FC<VideoUploadFormProps> = ({ authToken, onClose }) => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const { uploadProgress, isUploading, error, startUpload, cancelUpload } = useVideoUpload(authToken);

  const formatFileSize = (bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  };

  const validateAndSetFile = useCallback((file: File) => {
    setValidationError(null);

    if (!SUPPORTED_TYPES.includes(file.type)) {
      setValidationError('Unsupported format. Use MP4, MOV, or AVI.');
      setSelectedFile(null);
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setValidationError('File too large. Maximum size is 10 GB.');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndSetFile(file);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) validateAndSetFile(file);
  }, [validateAndSetFile]);

  const handleUpload = async () => {
    if (!selectedFile) return;

    const sessionId = await startUpload(selectedFile);
    if (sessionId) {
      if (onClose) onClose();
      navigate(`/replay/${sessionId}`);
    }
  };

  const handleCancel = () => {
    if (isUploading) {
      cancelUpload();
    } else if (onClose) {
      onClose();
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setValidationError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold text-gray-900">Upload Video</h2>
        <button
          onClick={handleCancel}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Drop zone / File selection */}
      {!selectedFile && !isUploading && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            relative cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-200
            ${isDragOver
              ? 'drop-zone-active border-indigo-400 scale-[1.01]'
              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
            }
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/x-msvideo"
            onChange={handleFileChange}
            className="hidden"
            aria-label="Select video file to upload"
          />
          <div className="flex flex-col items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors duration-200 ${isDragOver ? 'bg-indigo-100' : 'bg-gray-100'}`}>
              <svg className={`w-6 h-6 transition-colors duration-200 ${isDragOver ? 'text-indigo-500' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                Drop a video here or <span className="text-indigo-500">browse</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">MP4, MOV, or AVI up to 10 GB</p>
            </div>
          </div>
        </div>
      )}

      {/* Selected file */}
      {selectedFile && !isUploading && (
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{selectedFile.name}</p>
              <p className="text-xs text-gray-400">{formatFileSize(selectedFile.size)}</p>
            </div>
            <button
              onClick={handleRemoveFile}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Remove file"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Upload progress */}
      {isUploading && (
        <div className="animate-fade-in">
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <svg className="branded-spinner w-4 h-4 text-indigo-500" viewBox="0 0 50 50">
                  <circle cx="25" cy="25" r="20" fill="none" strokeWidth="5" />
                </svg>
                <span className="text-sm font-medium text-gray-700">
                  {uploadProgress === 100 ? 'Processing' : 'Uploading'}
                </span>
              </div>
              <span className="text-sm font-semibold text-gray-900 tabular-nums">{uploadProgress}%</span>
            </div>
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-400 bg-stripes animate-stripes transition-all duration-500 ease-out"
                style={{ width: `${uploadProgress}%` }}
                role="progressbar"
                aria-valuenow={uploadProgress}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
            {uploadProgress === 100 && (
              <p className="text-xs text-gray-400 mt-2.5 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Processing your video — usually takes 2-5 minutes
              </p>
            )}
          </div>
        </div>
      )}

      {/* Validation / upload errors */}
      {(validationError || error) && (
        <div className="mt-4 flex items-start gap-2.5 px-4 py-3 rounded-xl bg-red-50 border border-red-100 animate-fade-in">
          <svg className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span className="text-red-600 text-sm">{validationError || error}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-5 flex gap-2.5">
        {!isUploading ? (
          <>
            <button
              onClick={handleUpload}
              disabled={!selectedFile || !!validationError}
              className="flex-1 py-3 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-500 active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 shadow-sm shadow-green-600/10"
              aria-label="Start uploading video"
            >
              Upload
            </button>
            <button
              onClick={handleCancel}
              className="px-5 py-3 rounded-xl bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200 active:scale-[0.98] transition-all duration-150"
              aria-label="Close dialog"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={handleCancel}
            className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200 active:scale-[0.98] transition-all duration-150"
            aria-label="Cancel upload"
          >
            Cancel Upload
          </button>
        )}
      </div>
    </div>
  );
};
