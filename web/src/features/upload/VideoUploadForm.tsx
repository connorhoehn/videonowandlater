import React, { useState, useRef } from 'react';
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
  const { uploadProgress, isUploading, error, startUpload, cancelUpload } = useVideoUpload(authToken);

  const formatFileSize = (bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValidationError(null);
    const file = e.target.files?.[0];

    if (!file) return;

    // Validate file type
    if (!SUPPORTED_TYPES.includes(file.type)) {
      setValidationError(`Unsupported file type. Supported: MP4, MOV, AVI`);
      setSelectedFile(null);
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setValidationError(`File too large. Maximum size: 10 GB`);
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    const sessionId = await startUpload(selectedFile);
    if (sessionId) {
      // Successful upload; navigate to replay viewer
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

  return (
    <div className="w-full max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">Upload Video</h2>

      {/* File Input */}
      <div className="mb-6">
        <label htmlFor="video-input" className="block text-sm font-medium text-gray-700 mb-2">
          Select a video file
        </label>
        <input
          ref={fileInputRef}
          id="video-input"
          type="file"
          accept="video/mp4,video/quicktime,video/x-msvideo"
          onChange={handleFileChange}
          disabled={isUploading}
          aria-label="Select video file to upload"
          className="block w-full px-3 py-2 border border-gray-300 rounded-md text-gray-700 disabled:bg-gray-100"
        />
      </div>

      {/* File Info */}
      {selectedFile && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
          <p className="text-sm text-gray-700">
            <span className="font-semibold">File:</span> {selectedFile.name}
          </p>
          <p className="text-sm text-gray-700">
            <span className="font-semibold">Size:</span> {formatFileSize(selectedFile.size)}
          </p>
        </div>
      )}

      {/* Validation Error */}
      {validationError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {validationError}
        </div>
      )}

      {/* Upload Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Progress Bar */}
      {isUploading && (
        <div className="mb-4">
          <div className="flex justify-between mb-1">
            <span className="text-sm font-medium text-gray-700">Uploading...</span>
            <span className="text-sm font-medium text-gray-700">{uploadProgress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
              aria-valuenow={uploadProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              role="progressbar"
            />
          </div>
          {uploadProgress === 100 && (
            <p className="text-sm text-gray-600 mt-2">Processing... estimated 2-5 minutes</p>
          )}
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleUpload}
          disabled={!selectedFile || isUploading || !!validationError}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md font-medium disabled:bg-gray-400 hover:bg-blue-700 transition"
          aria-label="Start uploading video"
        >
          {isUploading ? 'Uploading...' : 'Upload'}
        </button>
        <button
          onClick={handleCancel}
          className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-md font-medium hover:bg-gray-400 transition"
          aria-label="Cancel upload or close dialog"
        >
          {isUploading ? 'Cancel' : 'Close'}
        </button>
      </div>
    </div>
  );
};
