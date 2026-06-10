/*
 * input.js -- User input handling and animation loop.
 *
 * Handles all direct user interaction with the canvas and document:
 * keyboard (held-key polling for continuous movement), mouse drag for
 * yaw/pitch panning, touch gestures (single-finger pan, two-finger
 * pinch-zoom and rotate), scroll wheel (zoom, Cmd/Ctrl+scroll for roll,
 * Alt+scroll for fisheye blend), and the requestAnimationFrame loop
 * that drives continuous key-held updates.
 *
 * Provides:
 *   held              -- Set of currently pressed keys
 *   dragging, dragX/Y -- mouse drag state
 *   touchMode, touchX/Y, touchDistance, touchAngle -- touch state
 *   MOUSE_SENS        -- mouse drag sensitivity constant
 *
 * Consumes (from state.js):
 *   loaded, yaw, pitch, roll, fDst, fisheyeK, ROT_SPD, ZOOM_SPD,
 *   TOUCH_PAN_SENS, frameResizing, frameMoving, reset()
 * Consumes (from renderer.js):
 *   cv, draw(), updateHUD()
 * Consumes (from frame.js):
 *   applyFrameMove(), applyFrameResize(), maybeAutofit()
 * Consumes (from roll-slider.js):
 *   updateRollSlider()
 */
'use strict';

const held = new Set();

document.addEventListener('keydown', e => {
  held.add(e.key);
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','-','=','[',']'].includes(e.key))
    e.preventDefault();
  if (e.key === 'r' || e.key === 'R') { reset(); draw(); updateHUD(); maybeAutofit(); }
});
document.addEventListener('keyup', e => held.delete(e.key));

// ---- Mouse drag -------------------------------------------------------------
let dragging = false, dragX = 0, dragY = 0;
const MOUSE_SENS = 0.004;

cv.addEventListener('mousedown', e => {
  if (!loaded) return;
  if (frameResizing || frameMoving) return;
  dragging = true; dragX = e.clientX; dragY = e.clientY;
  cv.classList.add('dragging');
});
document.addEventListener('mousemove', e => {
  if (frameMoving) {
    applyFrameMove(e.clientX, e.clientY);
    return;
  }
  if (frameResizing) {
    applyFrameResize(e.clientX - resizeStartX, e.clientY - resizeStartY);
    return;
  }
  if (!dragging) return;
  const dx = e.clientX - dragX;
  const dy = e.clientY - dragY;
  dragX = e.clientX; dragY = e.clientY;
  yaw   -= dx * MOUSE_SENS;
  pitch -= dy * MOUSE_SENS;
  draw(); updateHUD(); maybeAutofit();
});
document.addEventListener('mouseup', () => {
  dragging = false; frameResizing = false; frameMoving = false;
  cv.classList.remove('dragging');
  document.body.style.cursor = '';
});

// ---- Touch gestures ---------------------------------------------------------
let touchMode = null;
let touchX = 0, touchY = 0;
let touchDistance = 0, touchAngle = 0;

function getTouchDistance(a, b) {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function getTouchAngle(a, b) {
  return Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
}

cv.addEventListener('touchstart', e => {
  if (!loaded) return;

  if (e.touches.length === 1) {
    const touch = e.touches[0];
    touchMode = 'pan';
    touchX = touch.clientX;
    touchY = touch.clientY;
    return;
  }

  if (e.touches.length >= 2) {
    touchMode = 'gesture';
    touchDistance = getTouchDistance(e.touches[0], e.touches[1]);
    touchAngle = getTouchAngle(e.touches[0], e.touches[1]);
  }
}, { passive: true });

cv.addEventListener('touchmove', e => {
  if (!loaded) return;

  if (touchMode === 'pan' && e.touches.length === 1) {
    e.preventDefault();
    const touch = e.touches[0];
    const dx = touch.clientX - touchX;
    const dy = touch.clientY - touchY;
    touchX = touch.clientX;
    touchY = touch.clientY;
    yaw -= dx * TOUCH_PAN_SENS;
    pitch -= dy * TOUCH_PAN_SENS;
    draw(); updateHUD(); maybeAutofit();
    return;
  }

  if (e.touches.length >= 2) {
    e.preventDefault();
    const nextDistance = getTouchDistance(e.touches[0], e.touches[1]);
    const nextAngle = getTouchAngle(e.touches[0], e.touches[1]);

    if (touchDistance > 0 && nextDistance > 0) {
      fDst *= nextDistance / touchDistance;
    }
    roll += nextAngle - touchAngle;
    touchMode = 'gesture';
    touchDistance = nextDistance;
    touchAngle = nextAngle;
    draw(); updateHUD(); updateRollSlider(); maybeAutofit();
  }
}, { passive: false });

cv.addEventListener('touchend', e => {
  if (e.touches.length >= 2) {
    touchMode = 'gesture';
    touchDistance = getTouchDistance(e.touches[0], e.touches[1]);
    touchAngle = getTouchAngle(e.touches[0], e.touches[1]);
    return;
  }

  if (e.touches.length === 1) {
    const touch = e.touches[0];
    touchMode = 'pan';
    touchX = touch.clientX;
    touchY = touch.clientY;
    return;
  }

  touchMode = null;
}, { passive: true });

// ---- Scroll wheel -----------------------------------------------------------
cv.addEventListener('wheel', e => {
  if (!loaded) return;
  e.preventDefault();
  const ROLL_SENS = 0.003;
  const ZOOM_SENS = 0.001;
  if (e.altKey) {
    const FISHEYE_SENS = 0.002;
    fisheyeK = Math.max(0, Math.min(1, fisheyeK + e.deltaY * FISHEYE_SENS));
    document.getElementById('fisheye-k').value = fisheyeK;
  } else if (e.metaKey || e.ctrlKey) {
    roll += e.deltaY * ROLL_SENS;
    updateRollSlider();
  } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    roll += e.deltaX * ROLL_SENS;
    updateRollSlider();
  } else {
    fDst *= Math.exp(-e.deltaY * ZOOM_SENS);
  }
  draw(); updateHUD(); maybeAutofit();
}, { passive: false });

// ---- Animation loop ---------------------------------------------------------
let prevT = 0;
(function loop(t) {
  requestAnimationFrame(loop);
  if (!loaded) { prevT = t; return; }

  const dt = Math.min((t - prevT) / 1000, 0.1);
  prevT = t;

  let moved = false;

  if (held.has('ArrowLeft'))  { yaw   -= ROT_SPD * dt; moved = true; }
  if (held.has('ArrowRight')) { yaw   += ROT_SPD * dt; moved = true; }
  if (held.has('ArrowUp'))    { pitch -= ROT_SPD * dt; moved = true; }
  if (held.has('ArrowDown'))  { pitch += ROT_SPD * dt; moved = true; }
  if (held.has('['))          { roll  -= ROT_SPD * dt; moved = true; }
  if (held.has(']'))          { roll  += ROT_SPD * dt; moved = true; }
  if (held.has('-'))          { fDst *= Math.exp(-ZOOM_SPD * dt); moved = true; }
  if (held.has('='))          { fDst *= Math.exp( ZOOM_SPD * dt); moved = true; }

  if (moved) { draw(); updateHUD(); updateRollSlider(); maybeAutofit(); }
})();
