import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { VideoUploadForm } from '../VideoUploadForm';

// Mock useVideoUpload hook
vi.mock('../useVideoUpload', () => ({
  useVideoUpload: () => ({
    uploadProgress: 0,
    isUploading: false,
    error: null,
    startUpload: vi.fn().mockResolvedValue('test-session-id'),
    cancelUpload: vi.fn(),
  }),
}));

describe('VideoUploadForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render file input and buttons', () => {
    render(
      <BrowserRouter>
        <VideoUploadForm authToken="test-token" />
      </BrowserRouter>
    );

    expect(screen.getByLabelText(/select video file/i)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('should validate file size and reject >10GB files', async () => {
    render(
      <BrowserRouter>
        <VideoUploadForm authToken="test-token" />
      </BrowserRouter>
    );

    const fileInput = screen.getByLabelText(/select video file/i) as HTMLInputElement;
    // Create a file that's larger than 10GB (in mock, we just need to exceed size)
    const oversizedFile = new File(['x'.repeat(1024)], 'large.mp4', {
      type: 'video/mp4',
    });
    // Override size since File constructor doesn't support size override
    Object.defineProperty(oversizedFile, 'size', { value: 11 * 1024 * 1024 * 1024 });

    fireEvent.change(fileInput, { target: { files: [oversizedFile] } });

    await waitFor(() => {
      expect(screen.getByText(/file too large/i)).toBeInTheDocument();
    });
  });

  it('should validate mime type and reject unsupported formats', async () => {
    render(
      <BrowserRouter>
        <VideoUploadForm authToken="test-token" />
      </BrowserRouter>
    );

    const fileInput = screen.getByLabelText(/select video file/i) as HTMLInputElement;
    const invalidFile = new File(['test'], 'video.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    await waitFor(() => {
      expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
    });
  });

  it('should display file name and size after selection', async () => {
    render(
      <BrowserRouter>
        <VideoUploadForm authToken="test-token" />
      </BrowserRouter>
    );

    const fileInput = screen.getByLabelText(/select video file/i) as HTMLInputElement;
    const validFile = new File(['test'.repeat(1024)], 'sample.mp4', { type: 'video/mp4' });

    fireEvent.change(fileInput, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(screen.getByText(/sample.mp4/i)).toBeInTheDocument();
      expect(screen.getByText(/4.00 KB/i)).toBeInTheDocument();
    });
  });

  it('should disable upload button when file is not selected', () => {
    render(
      <BrowserRouter>
        <VideoUploadForm authToken="test-token" />
      </BrowserRouter>
    );

    const buttons = screen.getAllByRole('button');
    const uploadButton = buttons.find(b => b.textContent === 'Upload');
    expect(uploadButton).toBeDefined();
    expect(uploadButton).toBeDisabled();
  });

  it('should disable upload button when validation error exists', async () => {
    render(
      <BrowserRouter>
        <VideoUploadForm authToken="test-token" />
      </BrowserRouter>
    );

    const fileInput = screen.getByLabelText(/select video file/i) as HTMLInputElement;
    const invalidFile = new File(['test'], 'video.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const uploadButton = buttons.find(b => b.textContent === 'Upload');
      expect(uploadButton).toBeDefined();
      expect(uploadButton).toBeDisabled();
    });
  });

  it('should render title and heading', () => {
    render(
      <BrowserRouter>
        <VideoUploadForm authToken="test-token" />
      </BrowserRouter>
    );

    expect(screen.getByText('Upload Video')).toBeInTheDocument();
  });

  it('should have proper accessibility attributes', () => {
    render(
      <BrowserRouter>
        <VideoUploadForm authToken="test-token" />
      </BrowserRouter>
    );

    const fileInput = screen.getByLabelText(/select video file/i);
    expect(fileInput).toHaveAttribute('aria-label', 'Select video file to upload');
  });

  it('should accept .mp4 files', async () => {
    render(
      <BrowserRouter>
        <VideoUploadForm authToken="test-token" />
      </BrowserRouter>
    );

    const fileInput = screen.getByLabelText(/select video file/i) as HTMLInputElement;
    const mp4File = new File(['test'], 'video.mp4', { type: 'video/mp4' });

    fireEvent.change(fileInput, { target: { files: [mp4File] } });

    await waitFor(() => {
      expect(screen.getByText(/video.mp4/i)).toBeInTheDocument();
    });
  });

  it('should accept .mov files', async () => {
    render(
      <BrowserRouter>
        <VideoUploadForm authToken="test-token" />
      </BrowserRouter>
    );

    const fileInput = screen.getByLabelText(/select video file/i) as HTMLInputElement;
    const movFile = new File(['test'], 'video.mov', { type: 'video/quicktime' });

    fireEvent.change(fileInput, { target: { files: [movFile] } });

    await waitFor(() => {
      expect(screen.getByText(/video.mov/i)).toBeInTheDocument();
    });
  });

  it('should call onClose when close button clicked and not uploading', () => {
    const onCloseMock = vi.fn();
    render(
      <BrowserRouter>
        <VideoUploadForm authToken="test-token" onClose={onCloseMock} />
      </BrowserRouter>
    );

    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);

    expect(onCloseMock).toHaveBeenCalled();
  });
});
