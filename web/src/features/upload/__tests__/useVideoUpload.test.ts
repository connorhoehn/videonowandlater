import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideoUpload } from '../useVideoUpload';

// Mock config
vi.mock('../../../config/aws-config', () => ({
  getConfig: () => ({
    apiUrl: 'https://api.example.com',
  }),
}));

describe('useVideoUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useVideoUpload('test-token'));

    expect(result.current.uploadProgress).toBe(0);
    expect(result.current.isUploading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should return error if no auth token', async () => {
    const { result } = renderHook(() => useVideoUpload(null));

    let sessionId: string | null = null;
    await act(async () => {
      sessionId = await result.current.startUpload(new File(['test'], 'test.mp4', { type: 'video/mp4' }));
    });

    expect(sessionId).toBeNull();
    expect(result.current.error).toBe('Authentication required');
  });

  it('should provide startUpload and cancelUpload functions', () => {
    const { result } = renderHook(() => useVideoUpload('test-token'));

    expect(typeof result.current.startUpload).toBe('function');
    expect(typeof result.current.cancelUpload).toBe('function');
  });

  it('should have progress state that can be updated', () => {
    const { result } = renderHook(() => useVideoUpload('test-token'));

    expect(result.current.uploadProgress).toBe(0);
    expect(result.current.isUploading).toBe(false);
  });

  it('should return null sessionId on auth error', async () => {
    const { result } = renderHook(() => useVideoUpload(null));
    const testFile = new File(['test'], 'test.mp4', { type: 'video/mp4' });

    let returnedSessionId: string | null = 'not-set';
    await act(async () => {
      returnedSessionId = await result.current.startUpload(testFile);
    });

    expect(returnedSessionId).toBeNull();
  });
});
