/**
 * Hand tracking via MediaPipe Hands. Emits cursor:moved and cursor:grab events via callbacks
 */

let handsModuleLoaded = false;
let cameraUtilsLoaded = false;
let onMoveCb = () => {};
let onGrabCb = () => {};
let onOpenHandCb = () => {};
let rafId = null;
let lastGrabFrames = 0;
const GRAB_THRESHOLD = 0.3; // normalized distance for closed fist (extremely sensitive)
const GRAB_HOLD_FRAMES = 2; // extremely quick detection (just 2 frames)
const GRAB_COOLDOWN = 30; // frames to wait after a grab (about 1 second)
let grabCooldownFrames = 0;
let videoElRef = null;
let hands = null;
let mpCamera = null;
let browseMode = false;
let debugGrab = false;

export function onCursorMove(cb) { onMoveCb = cb; }
export function onGrab(cb) { onGrabCb = cb; }
export function onOpenHand(cb) { onOpenHandCb = cb; }
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
        if (hands) {
          await hands.send({ image: videoEl });
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
  if (mpCamera) { try { mpCamera.stop(); } catch (_) {} }
  cancelAnimationFrame(rafId);
  hands = null; mpCamera = null; lastGrabFrames = 0; browseMode = false;
}

function onResults(results) {
  const landmarks = results?.multiHandLandmarks?.[0];
  if (!landmarks) return;

  const w = window.innerWidth; const h = window.innerHeight;

  // Use palm center (landmark 0) for cursor position in browse mode
  const palmCenter = landmarks[0];
  const x = palmCenter.x * w;
  const y = palmCenter.y * h;
  onMoveCb({ x, y });

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

    // Extremely lenient: just 1 finger closed counts, or thumb close to palm
    const isFist = closedCount >= 1 || thumbDist < GRAB_THRESHOLD * 1.5;

    if (debugGrab && Math.random() < 0.1) {
      console.log('[Hand] Grab detection:', {
        closedCount,
        thumbDist,
        isFist,
        distances,
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
      }
    } else {
      lastGrabFrames = 0;
      onOpenHandCb();
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
