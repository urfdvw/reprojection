/*
 * frame.js -- Frame overlay and crop-fit-to-valid-pixels logic.
 *
 * Manages the crop frame that overlays the preview canvas. The frame
 * geometry lives in image-pixel space so it is stable across viewport
 * resizes. This file also contains the CPU-side reprojection test used
 * to fit the frame to the largest rectangle of valid output pixels.
 *
 * Provides:
 *   imgScale()             -- CSS px per image px for current viewport
 *   positionFrame()        -- sync CSS from image-space frame coords
 *   clampFrame()           -- keep frame corners inside viewport
 *   getTargetRatio()       -- read selected aspect ratio from dropdown
 *   applyRatioSnap()       -- resize frame to match selected ratio
 *   applyFrameMove(cx,cy)  -- move frame during drag
 *   applyFrameResize(dx,dy)-- resize frame during drag
 *   updateFrame()          -- initialise or refresh frame position
 *   isValidOutput(sx,sy)   -- CPU reprojection validity test
 *   rectIsValid(...)       -- test if a rectangle is fully valid
 *   fitFrameToValid()      -- binary-search largest valid frame
 *   maybeAutofit()         -- conditionally call fitFrameToValid
 *   autofit                -- boolean flag for continuous auto-fit
 *
 * Consumes (from state.js):
 *   loaded, imgW, imgH, fSrc, fDst, fisheyeK, yaw, pitch, roll,
 *   frameImgX/Y/W/H, resizeStartImgX/Y/W/H, resizeStartX/Y,
 *   resizeHandle, viewW(), viewH()
 * Consumes (from renderer.js):
 *   rotMat(), updateHUD()
 */
'use strict';

const frameEl = document.getElementById('frame-box');

function imgScale() { return Math.min(viewW() / imgW, viewH() / imgH); }

function positionFrame() {
  const s = imgScale();
  const ww = viewW(), wh = viewH();
  frameEl.style.left    = (ww / 2 + frameImgX * s) + 'px';
  frameEl.style.top     = (wh / 2 + frameImgY * s) + 'px';
  frameEl.style.width   = (frameImgW * s) + 'px';
  frameEl.style.height  = (frameImgH * s) + 'px';
  frameEl.style.display = 'block';
}

function clampFrame() {
  const s = imgScale();
  const ww = viewW(), wh = viewH();
  frameImgX = Math.max(-ww / 2 / s,  Math.min((ww / 2 - frameImgW * s) / s, frameImgX));
  frameImgY = Math.max(-wh / 2 / s,  Math.min((wh / 2 - frameImgH * s) / s, frameImgY));
}

function getTargetRatio() {
  const sel = document.getElementById('frame-ratio').value;
  if (sel === 'original') return imgW / imgH;
  if (sel === 'freeform')  return 0;
  const parts = sel.split(':');
  return parts.length === 2 ? parseFloat(parts[0]) / parseFloat(parts[1]) : 0;
}

function applyRatioSnap() {
  if (!loaded) return;
  const sel = document.getElementById('frame-ratio').value;
  if (sel === 'original') {
    frameImgX = -imgW / 2;
    frameImgY = -imgH / 2;
    frameImgW = imgW;
    frameImgH = imgH;
    return;
  }
  const ratio = getTargetRatio();
  if (ratio <= 0) return;
  const s = imgScale();
  const ww = viewW(), wh = viewH();
  const maxWi = (ww - 14) / s, maxHi = (wh - 14) / s;
  frameImgH = frameImgW / ratio;
  if (frameImgH > maxHi) { frameImgH = maxHi; frameImgW = frameImgH * ratio; }
  if (frameImgW > maxWi) { frameImgW = maxWi; frameImgH = frameImgW / ratio; }
  frameImgX = -frameImgW / 2;
  frameImgY = -frameImgH / 2;
}

function applyFrameMove(cx, cy) {
  const s = imgScale();
  frameImgX = resizeStartImgX + (cx - resizeStartX) / s;
  frameImgY = resizeStartImgY + (cy - resizeStartY) / s;
  clampFrame(); positionFrame(); updateHUD();
}

function applyFrameResize(dx, dy) {
  const s = imgScale();
  const dxi = dx / s;
  const dyi = dy / s;
  const ratio = getTargetRatio();
  const h = resizeHandle;
  const MIN = 20 / s;

  const mR = h==='e'||h==='se'||h==='ne';
  const mL = h==='w'||h==='sw';
  const mB = h==='s'||h==='se'||h==='sw';
  const mT = h==='n'||h==='ne';

  let newW = Math.max(MIN, resizeStartImgW + (mR ? dxi : mL ? -dxi : 0));
  let newH = Math.max(MIN, resizeStartImgH + (mB ? dyi : mT ? -dyi : 0));

  const fixedL  = resizeStartImgX;
  const fixedR  = resizeStartImgX + resizeStartImgW;
  const fixedT  = resizeStartImgY;
  const fixedB  = resizeStartImgY + resizeStartImgH;
  const fixedCx = resizeStartImgX + resizeStartImgW / 2;
  const fixedCy = resizeStartImgY + resizeStartImgH / 2;

  if (ratio > 0) {
    const isCorner = (mR || mL) && (mT || mB);
    if (!isCorner) {
      if (mR || mL) newH = newW / ratio;
      else          newW = newH * ratio;
    } else {
      if (Math.abs(dx) >= Math.abs(dy)) newH = newW / ratio;
      else                               newW = newH * ratio;
    }
    newW = Math.max(MIN, newW);
    newH = Math.max(MIN, newH);
  }

  frameImgX = mR ? fixedL : mL ? fixedR - newW : fixedCx - newW / 2;
  frameImgY = mB ? fixedT : mT ? fixedB - newH : fixedCy - newH / 2;
  frameImgW = newW;
  frameImgH = newH;
  clampFrame();
  positionFrame();
  updateHUD();
}

function updateFrame() {
  if (!loaded) return;
  if (frameImgW === 0) {
    frameImgX = -imgW / 2;
    frameImgY = -imgH / 2;
    frameImgW = imgW;
    frameImgH = imgH;
  }
  positionFrame();
}

// ---- Crop fit-to-valid-pixels -----------------------------------------------

function isValidOutput(sx, sy) {
  const r = Math.hypot(sx, sy);
  let dx, dy, dz;
  if (r < 0.0001) { dx = 0; dy = 0; dz = 1; }
  else {
    const t1 = Math.atan(r / fDst);
    const t2 = r / fDst;
    const theta = (1 - fisheyeK) * t1 + fisheyeK * t2;
    const st = Math.sin(theta), ct = Math.cos(theta);
    dx = (sx / r) * st;
    dy = (sy / r) * st;
    dz = ct;
  }
  const m = rotMat(yaw, pitch, roll);
  const rx = m[0] * dx + m[3] * dy + m[6] * dz;
  const ry = m[1] * dx + m[4] * dy + m[7] * dz;
  const rz = m[2] * dx + m[5] * dy + m[8] * dz;
  if (rz <= 0) return false;
  const hx = (fSrc / rz) * rx;
  const hy = (fSrc / rz) * ry;
  const ux = hx / imgW + 0.5;
  const uy = hy / imgH + 0.5;
  return ux >= 0 && ux <= 1 && uy >= 0 && uy <= 1;
}

function rectIsValid(ix, iy, w, h, samples = 24) {
  const N = samples;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x1 = ix + t * w,       y1 = iy;
    const x2 = ix + t * w,       y2 = iy + h;
    const x3 = ix,               y3 = iy + t * h;
    const x4 = ix + w,           y4 = iy + t * h;
    if (!isValidOutput(x1, -y1)) return false;
    if (!isValidOutput(x2, -y2)) return false;
    if (!isValidOutput(x3, -y3)) return false;
    if (!isValidOutput(x4, -y4)) return false;
  }
  const M = 6;
  for (let i = 1; i < M; i++) {
    for (let j = 1; j < M; j++) {
      const x = ix + (i / M) * w;
      const y = iy + (j / M) * h;
      if (!isValidOutput(x, -y)) return false;
    }
  }
  return true;
}

let autofit = false;

function fitFrameToValid() {
  if (!loaded) return false;
  let cx = frameImgX + frameImgW / 2;
  let cy = frameImgY + frameImgH / 2;
  if (frameImgW <= 0 || !isValidOutput(cx, -cy)) { cx = 0; cy = 0; }
  if (!isValidOutput(cx, -cy)) { return false; }

  const sel = document.getElementById('frame-ratio').value;
  let ratio;
  if (sel === 'freeform') ratio = (frameImgW > 0 && frameImgH > 0) ? (frameImgW / frameImgH) : (imgW / imgH);
  else                     ratio = getTargetRatio() || (imgW / imgH);

  const diag = Math.hypot(imgW, imgH);
  let lo = 0, hi = diag;
  for (let i = 0; i < 6; i++) {
    const halfW = hi;
    const halfH = halfW / ratio;
    if (rectIsValid(cx - halfW, cy - halfH, halfW * 2, halfH * 2, 12)) {
      lo = hi; break;
    } else break;
  }
  for (let iter = 0; iter < 22; iter++) {
    const mid = (lo + hi) / 2;
    const halfH = mid / ratio;
    if (rectIsValid(cx - mid, cy - halfH, mid * 2, halfH * 2, 16)) lo = mid;
    else hi = mid;
  }
  const halfW = lo;
  const halfH = halfW / ratio;
  if (halfW < 4) return false;

  frameImgW = halfW * 2;
  frameImgH = halfH * 2;
  frameImgX = cx - halfW;
  frameImgY = cy - halfH;
  positionFrame();
  updateHUD();
  return true;
}

function maybeAutofit() {
  if (autofit && loaded) fitFrameToValid();
}
