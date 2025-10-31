/**
 * Camera utilities
 * - Initializes getUserMedia at 720p (or best effort)
 * - Provides video element and frame capture into ImageData
 */

let stream = null;
let videoEl = null;
let captureCanvas = null;
let captureCtx = null;

export function getVideoEl() { return videoEl; }

export async function initCamera(constraints = { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }}, audio: false }) {
  console.log('[Camera] Initializing camera...');
  if (!navigator.mediaDevices?.getUserMedia) {
    console.error('[Camera] getUserMedia not supported');
    throw new Error('getUserMedia not supported');
  }
  if (!videoEl) videoEl = document.getElementById('webcam-video');
  if (!captureCanvas) {
    captureCanvas = document.createElement('canvas');
    captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
  }

  // If camera already running, just reuse it
  if (stream && videoEl && videoEl.srcObject) {
    console.log('[Camera] Camera already running, reusing existing stream');
    return;
  }

  try {
    console.log('[Camera] Requesting camera access with constraints:', constraints);
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('[Camera] Camera access granted, stream:', stream);
    videoEl.srcObject = stream;
    await videoEl.play();
    console.log('[Camera] Video playing, dimensions:', videoEl.videoWidth, 'x', videoEl.videoHeight);
    captureCanvas.width = videoEl.videoWidth || 1280;
    captureCanvas.height = videoEl.videoHeight || 720;
  } catch (error) {
    console.error('[Camera] Failed to initialize camera:', error);
    // Try fallback without facingMode constraint
    try {
      console.log('[Camera] Trying fallback without facingMode...');
      const fallbackConstraints = { video: { width: { ideal: 1280 }, height: { ideal: 720 }}, audio: false };
      stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      videoEl.srcObject = stream;
      await videoEl.play();
      console.log('[Camera] Fallback successful');
      captureCanvas.width = videoEl.videoWidth || 1280;
      captureCanvas.height = videoEl.videoHeight || 720;
    } catch (fallbackError) {
      console.error('[Camera] Fallback also failed:', fallbackError);
      throw fallbackError;
    }
  }
}

export async function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  if (videoEl) {
    videoEl.srcObject = null;
  }
}

export function getFrameImageData() {
  if (!videoEl || !captureCtx) return null;
  captureCtx.drawImage(videoEl, 0, 0, captureCanvas.width, captureCanvas.height);
  return captureCtx.getImageData(0, 0, captureCanvas.width, captureCanvas.height);
}
