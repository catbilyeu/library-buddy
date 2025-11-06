/**
 * Hand tracking via MediaPipe Hands. Emits cursor:moved and cursor:grab events via callbacks
 */

let handsModuleLoaded = false;
let cameraUtilsLoaded = false;
let onMoveCb = () => {};
let onGrabCb = () => {};
let onOpenHandCb = () => {};
let onWaveCb = () => {};
let rafId = null;
let lastGrabFrames = 0;
let lastFistState = false; // Track previous fist state to only trigger callbacks on state change
const GRAB_THRESHOLD = 0.22; // normalized distance for closed fist (stricter for more reliable detection)
const GRAB_HOLD_FRAMES = 3; // need to hold for 3 frames (about 100ms)
const GRAB_COOLDOWN = 25; // frames to wait after a grab (about 833ms)
let grabCooldownFrames = 0;

// Smoothing for cursor position
let smoothedX = 0;
let smoothedY = 0;
const SMOOTHING_FACTOR = 0.65; // Lower = more smoothing, higher = more responsive (increased for modal smoothness)

// Wave detection
let handPositionHistory = [];
const WAVE_HISTORY_SIZE = 12; // Track last 12 positions for smoother detection
const WAVE_THRESHOLD = 0.35; // Minimum horizontal distance to travel (normalized, more deliberate)
const WAVE_COOLDOWN = 75; // Cooldown between wave detections (2.5 seconds)
let waveCooldownFrames = 0;
let videoElRef = null;
let hands = null;
let mpCamera = null;
let browseMode = false;
let debugGrab = false;
let isProcessing = false; // Prevent overlapping frame processing

export function onCursorMove(cb) { onMoveCb = cb; }
export function onGrab(cb) { onGrabCb = cb; }
export function onOpenHand(cb) { onOpenHandCb = cb; }
export function onWave(cb) { onWaveCb = cb; }
export function setBrowseMode(enabled) { browseMode = enabled; }

export async function initHands(videoEl) {
  videoElRef = videoEl;

  try {
    if (!handsModuleLoaded) {
      await import('https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915');
      handsModuleLoaded = true;
    }
    if (!cameraUtilsLoaded) {
      await import('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1632432234');
      cameraUtilsLoaded = true;
    }

    // eslint-disable-next-line no-undef
    const { Hands } = window;
    // eslint-disable-next-line no-undef
    const { Camera } = window;

    hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    });

    hands.onResults(onResults);

    mpCamera = new Camera(videoEl, {
      onFrame: async () => {
        // Skip frame if still processing previous one
        if (hands && !isProcessing) {
          isProcessing = true;
          try {
            await hands.send({ image: videoEl });
          } catch (error) {
            console.error('[Hand] Error processing frame:', error);
          } finally {
            isProcessing = false;
          }
        }
      },
      width: 640,
      height: 480
    });

    await mpCamera.start();
    console.log('[Hand] MediaPipe Hands initialized successfully');
  } catch (error) {
    console.error('[Hand] Failed to initialize hand tracking:', error);
    throw error;
  }
}

export function destroyHands() {
  console.log('[Hand] Destroying hand tracking...');
  if (mpCamera) {
    try {
      console.log('[Hand] Stopping MediaPipe camera...');
      mpCamera.stop();
    } catch (e) {
      console.warn('[Hand] Error stopping MediaPipe camera:', e);
    }
  }
  if (rafId) {
    cancelAnimationFrame(rafId);
    console.log('[Hand] Cancelled animation frame');
  }
  isProcessing = false; // Reset processing flag
  hands = null;
  mpCamera = null;
  lastGrabFrames = 0;
  lastFistState = false;
  grabCooldownFrames = 0;
  browseMode = false;
  handPositionHistory = [];
  waveCooldownFrames = 0;
  smoothedX = 0;
  smoothedY = 0;
  console.log('[Hand] Hand tracking destroyed');
}

function onResults(results) {
  const landmarks = results?.multiHandLandmarks?.[0];
  if (!landmarks) return;

  const w = window.innerWidth; const h = window.innerHeight;

  // Use palm center (landmark 0) for cursor position in browse mode
  const palmCenter = landmarks[0];

  // Extend range slightly to ensure full screen coverage
  // Map from [0.1, 0.9] to [0, 1] for better edge access
  const normalizedX = (palmCenter.x - 0.1) / 0.8;
  const normalizedY = (palmCenter.y - 0.1) / 0.8;

  const targetX = Math.max(0, Math.min(w, normalizedX * w));
  const targetY = Math.max(0, Math.min(h, normalizedY * h));

  // Apply exponential smoothing to reduce jitter
  smoothedX = smoothedX + (targetX - smoothedX) * SMOOTHING_FACTOR;
  smoothedY = smoothedY + (targetY - smoothedY) * SMOOTHING_FACTOR;

  onMoveCb({ x: smoothedX, y: smoothedY });

  // Only track wave detection when not in browse mode (performance optimization)
  if (!browseMode) {
    // Track hand position for wave detection
    handPositionHistory.push({ x: palmCenter.x, y: palmCenter.y, timestamp: Date.now() });
    if (handPositionHistory.length > WAVE_HISTORY_SIZE) {
      handPositionHistory.shift();
    }

    // Detect wave gesture (rapid horizontal movement)
    if (waveCooldownFrames > 0) {
      waveCooldownFrames--;
    } else if (handPositionHistory.length >= WAVE_HISTORY_SIZE) {
      const oldest = handPositionHistory[0];
      const newest = handPositionHistory[handPositionHistory.length - 1];
      const horizontalDistance = Math.abs(newest.x - oldest.x);
      const verticalDistance = Math.abs(newest.y - oldest.y);
      const timeDiff = newest.timestamp - oldest.timestamp;

      // Wave detected: significant horizontal movement, minimal vertical, moderate speed
      if (horizontalDistance > WAVE_THRESHOLD && verticalDistance < 0.12 && timeDiff < 600) {
        console.log('[Hand] WAVE detected!', { horizontalDistance, verticalDistance, timeDiff });
        onWaveCb();
        waveCooldownFrames = WAVE_COOLDOWN;
        handPositionHistory = []; // Clear history after detection
      }
    }
  }

  if (browseMode) {
    // Decrement cooldown
    if (grabCooldownFrames > 0) {
      grabCooldownFrames--;
      return; // Skip grab detection during cooldown
    }

    // Detect closed fist by checking if fingertips are close to palm
    const fingertips = [8, 12, 16, 20]; // index, middle, ring, pinky
    const palmBase = landmarks[0];
    const thumb = landmarks[4];

    let closedCount = 0;
    const distances = [];

    for (const tip of fingertips) {
      const fingerTip = landmarks[tip];
      const dx = fingerTip.x - palmBase.x;
      const dy = fingerTip.y - palmBase.y;
      const dz = (fingerTip.z || 0) - (palmBase.z || 0);
      const dist = Math.hypot(dx, dy, dz);
      distances.push(dist);

      if (dist < GRAB_THRESHOLD) {
        closedCount++;
      }
    }

    // Also check thumb position
    const thumbDist = Math.hypot(
      thumb.x - palmBase.x,
      thumb.y - palmBase.y,
      (thumb.z || 0) - (palmBase.z || 0)
    );

    // Require ALL 4 fingers closed for a proper fist (stricter detection)
    const thumbClosed = thumbDist < GRAB_THRESHOLD * 1.3;
    const isFist = closedCount === 4 && thumbClosed;

    // Log occasionally for debugging (reduced frequency for better performance)
    if (Math.random() < 0.02) {
      console.log('[Hand] Grab detection:', {
        closedCount,
        thumbDist: thumbDist.toFixed(3),
        thumbClosed,
        isFist,
        avgDist: (distances.reduce((a, b) => a + b, 0) / distances.length).toFixed(3),
        frames: lastGrabFrames
      });
    }

    if (isFist) {
      lastGrabFrames++;
      if (lastGrabFrames === GRAB_HOLD_FRAMES) {
        console.log('[Hand] GRAB detected! Starting cooldown.');
        onGrabCb();
        lastGrabFrames = 0; // Reset to prevent repeated grabs
        grabCooldownFrames = GRAB_COOLDOWN; // Start cooldown
        lastFistState = true;
      }
    } else {
      // Only call onOpenHandCb when state changes from fist to open (performance optimization)
      if (lastFistState) {
        onOpenHandCb();
        lastFistState = false;
      }
      lastGrabFrames = 0;
    }
  } else {
    // Original pinch detection for scan mode
    const indexTip = landmarks[8];
    const thumbTip = landmarks[4];
    const dx = indexTip.x - thumbTip.x;
    const dy = indexTip.y - thumbTip.y;
    const dz = (indexTip.z || 0) - (thumbTip.z || 0);
    const dist = Math.hypot(dx, dy, dz);

    if (dist < 0.045) {
      lastGrabFrames++;
      if (lastGrabFrames === GRAB_HOLD_FRAMES) {
        onGrabCb();
        lastGrabFrames = 0;
      }
    } else {
      lastGrabFrames = 0;
    }
  }
}
