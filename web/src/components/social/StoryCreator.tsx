import { useState, useRef, useEffect, useCallback } from 'react';
import { Card } from './Card';
import { CloseIcon, UploadIcon, CheckIcon, PhotoIcon, VideoIcon } from './Icons';
import { ContentPicker, type SelectedContent } from './ContentPicker';
import { useStoryCreator } from '../../hooks/useStoryCreator';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface StoryCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onPublished?: () => void;
}

const MAX_SEGMENTS = 10;

type CreatorTab = 'library' | 'upload';

export function StoryCreator({ isOpen, onClose, onPublished }: StoryCreatorProps) {
  const trapRef = useFocusTrap(isOpen);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeCreatorTab, setActiveCreatorTab] = useState<CreatorTab>('library');
  const [librarySelection, setLibrarySelection] = useState<SelectedContent[]>([]);
  const { segments, publishing: isPublishing, error, startStory, addFiles, addFromSession, publish, removeSegment } =
    useStoryCreator();

  // Start story session when modal opens
  useEffect(() => {
    if (isOpen) {
      startStory();
      setActiveCreatorTab('library');
      setLibrarySelection([]);
    }
  }, [isOpen, startStory]);

  // Escape key
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, handleEscape]);

  // Body scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const allUploaded =
    segments.length > 0 && segments.every((s) => s.status === 'done');
  const canAddMore = segments.length < MAX_SEGMENTS;

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    addFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handlePublish = async () => {
    const ok = await publish();
    if (ok) {
      onPublished?.();
      onClose();
    }
  };

  const handleAddFromLibrary = () => {
    for (const item of librarySelection) {
      // Avoid adding duplicates already in segments
      const alreadyAdded = segments.some((s) => s.sourceSessionId === item.sessionId);
      if (!alreadyAdded && segments.length < MAX_SEGMENTS) {
        addFromSession(item.sessionId, item.type, item.thumbnailUrl, item.label);
      }
    }
    setLibrarySelection([]);
  };

  const handleLibrarySelect = (items: SelectedContent[]) => {
    setLibrarySelection(items);
  };

  // Track which session IDs are already added as segments
  const addedSessionIds = segments
    .filter((s) => s.sourceSessionId)
    .map((s) => s.sourceSessionId!);

  const isImage = (file?: File) => file?.type.startsWith('image/') ?? false;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <style>{`
        @keyframes story-creator-in {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>

      <div
        ref={trapRef}
        className="max-w-lg w-full mx-4 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        style={{ animation: 'story-creator-in 150ms ease-out' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <Card.Header borderless>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            Create Story
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors cursor-pointer"
          >
            <CloseIcon size={18} />
          </button>
        </Card.Header>

        {/* Tab bar */}
        {!isPublishing && (
          <div className="flex border-b border-gray-200 dark:border-gray-700 px-4">
            <button
              type="button"
              onClick={() => setActiveCreatorTab('library')}
              className={`
                px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer relative
                ${activeCreatorTab === 'library'
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }
              `}
            >
              Library
              {activeCreatorTab === 'library' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-full" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveCreatorTab('upload')}
              className={`
                px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer relative
                ${activeCreatorTab === 'upload'
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }
              `}
            >
              Upload
              {activeCreatorTab === 'upload' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-full" />
              )}
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Publishing state */}
          {isPublishing && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <svg
                className="animate-spin h-8 w-8 text-blue-600"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Publishing your story...
              </p>
            </div>
          )}

          {/* Library tab */}
          {!isPublishing && activeCreatorTab === 'library' && (
            <div>
              <ContentPicker
                onSelect={handleLibrarySelect}
                maxItems={MAX_SEGMENTS - segments.length}
                selectedIds={[
                  ...librarySelection.map((s) => s.sessionId),
                  ...addedSessionIds,
                ]}
              />

              {/* Selected items preview strip */}
              {librarySelection.length > 0 && (
                <div className="px-4 pb-3">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {librarySelection.map((item) => (
                      <div
                        key={item.sessionId}
                        className="relative flex-shrink-0 w-14 h-14 rounded-md overflow-hidden ring-2 ring-blue-500"
                      >
                        {item.thumbnailUrl ? (
                          <img
                            src={item.thumbnailUrl}
                            alt={item.label}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                            <VideoIcon size={16} className="text-gray-400" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={handleAddFromLibrary}
                    disabled={!canAddMore}
                    className="mt-2 w-full py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add to Story ({librarySelection.length})
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Upload tab */}
          {!isPublishing && activeCreatorTab === 'upload' && (
            <div className="px-4 py-3">
              {/* Drop zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  cursor-pointer rounded-xl p-8 text-center transition-all duration-200
                  border-2 border-dashed
                  ${isDragOver
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 scale-[1.01]'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/30'
                  }
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={(e) => handleFileSelect(e.target.files)}
                  className="hidden"
                  aria-label="Select photos or videos"
                />
                <div className="flex flex-col items-center gap-3">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${
                      isDragOver
                        ? 'bg-blue-100 dark:bg-blue-800'
                        : 'bg-gray-100 dark:bg-gray-700'
                    }`}
                  >
                    <UploadIcon
                      size={24}
                      className={`transition-colors ${
                        isDragOver
                          ? 'text-blue-500'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      Drop photos or videos here
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      or click to browse
                    </p>
                  </div>
                </div>
              </div>

              {/* Add more button when segments exist */}
              {canAddMore && segments.length > 0 && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-3 w-full py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors cursor-pointer"
                >
                  + Add more files
                </button>
              )}
            </div>
          )}

          {/* Combined segment strip — shown for both tabs when segments exist */}
          {!isPublishing && segments.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                {segments.length} / {MAX_SEGMENTS} segments
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {segments.map((seg, i) => (
                  <div key={seg.localId} className="relative flex-shrink-0 group">
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                      {/* Thumbnail for library segments */}
                      {seg.thumbnailUrl ? (
                        <img
                          src={seg.thumbnailUrl}
                          alt={seg.label || 'Segment'}
                          className="w-full h-full object-cover"
                        />
                      ) : isImage(seg.file) ? (
                        <PhotoIcon
                          size={20}
                          className="text-gray-400 dark:text-gray-500"
                        />
                      ) : (
                        <VideoIcon
                          size={20}
                          className="text-gray-400 dark:text-gray-500"
                        />
                      )}

                      {/* Upload progress overlay */}
                      {seg.status === 'uploading' && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                          <svg
                            className="animate-spin h-5 w-5 text-white"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                            />
                          </svg>
                        </div>
                      )}

                      {/* Pending indicator */}
                      {seg.status === 'pending' && (
                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center rounded-lg">
                          <div className="w-2 h-2 rounded-full bg-gray-400 animate-pulse" />
                        </div>
                      )}

                      {/* Done indicator */}
                      {seg.status === 'done' && (
                        <div className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                          <CheckIcon size={10} className="text-white" />
                        </div>
                      )}

                      {/* Error indicator */}
                      {seg.status === 'error' && (
                        <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center rounded-lg">
                          <CloseIcon size={14} className="text-red-500" />
                        </div>
                      )}
                    </div>

                    {/* Remove button */}
                    <button
                      onClick={() => removeSegment(i)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-800 dark:bg-gray-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      aria-label="Remove segment"
                    >
                      <CloseIcon size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mx-4 mb-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800">
              <span className="text-red-600 dark:text-red-400 text-sm">
                {error}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        {!isPublishing && (
          <Card.Footer borderless className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handlePublish}
              disabled={!allUploaded}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 text-sm rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Share Story
            </button>
          </Card.Footer>
        )}
      </div>
    </div>
  );
}
