/*
 * state.js -- Application state, constants, layout helpers, and utilities.
 *
 * Loaded first. Every other script depends on the globals defined here.
 *
 * Provides:
 *   State variables  -- loaded, imgW/H, fSrc/fDst, yaw/pitch/roll, fisheyeK,
 *                       frameImgX/Y/W/H, frameResizing/Moving, resizeHandle,
 *                       resizeStart*, loadedFileName, loadedExifObj
 *   Constants        -- ROT_SPD, ZOOM_SPD, TOUCH_PAN_SENS, hasPiexif, EMPTY_EXIF,
 *                       DESKTOP_SIDEBAR_W, DESKTOP_BOTTOM_H, MOBILE_CTRL_H
 *   Layout helpers   -- viewW(), viewH(), resize(), isMobileScreen(),
 *                       isMobileDevice(), syncMobileUI()
 *   Utilities        -- pad(), fmtDeg(), setText()
 *   reset()          -- resets pose and zoom to defaults
 *
 * Consumes: nothing (loaded before all other scripts).
 */
'use strict';

const MOBILE_QUERY = '(max-width: 768px)';
const mobileQuery  = window.matchMedia(MOBILE_QUERY);

const DESKTOP_SIDEBAR_W = 320;
const DESKTOP_BOTTOM_H  = 26;
const MOBILE_CTRL_H = 188;

// ---- State ------------------------------------------------------------------
let loaded = false;
let imgW = 1, imgH = 1;
let fSrc = 1000, fDst = 1000;
let yaw = 0, pitch = 0, roll = 0;
let fisheyeK = 0;

let frameImgX = 0, frameImgY = 0, frameImgW = 0, frameImgH = 0;
let frameResizing = false, frameMoving = false, resizeHandle = '';
let resizeStartX = 0, resizeStartY = 0;
let resizeStartImgX = 0, resizeStartImgY = 0, resizeStartImgW = 0, resizeStartImgH = 0;
let loadedFileName = '';
let loadedExifObj = null;

// ---- Constants --------------------------------------------------------------
const ROT_SPD        = Math.PI / 3;
const ZOOM_SPD       = Math.LN2;
const TOUCH_PAN_SENS = 0.004;

const hasPiexif  = typeof piexif !== 'undefined';
const EMPTY_EXIF = { '0th': {}, 'Exif': {}, 'GPS': {}, 'Interop': {}, '1st': {} };

// ---- Utilities --------------------------------------------------------------
const pad = n => String(n).padStart(2, '0');
function fmtDeg(v) { return (v * 180 / Math.PI).toFixed(1) + '°'; }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

// ---- Layout helpers ---------------------------------------------------------
function viewW() {
  return mobileQuery.matches ? window.innerWidth : Math.max(0, window.innerWidth - DESKTOP_SIDEBAR_W);
}
function viewH() {
  return mobileQuery.matches
    ? Math.max(0, window.innerHeight - MOBILE_CTRL_H)
    : Math.max(0, window.innerHeight - DESKTOP_BOTTOM_H);
}

function isMobileScreen() {
  return mobileQuery.matches;
}

function isMobileDevice() {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPod/i.test(ua)) return true;
  if (/iPad/i.test(ua)) return true;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  return false;
}

function resize() {
  const dpr = devicePixelRatio || 1;
  const w = viewW(), h = viewH();
  cv.width  = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  gl.viewport(0, 0, cv.width, cv.height);
  const ch = document.getElementById('crosshair');
  ch.style.left = (w / 2) + 'px';
  ch.style.top  = (h / 2) + 'px';
}

function syncMobileUI() {
  document.body.classList.toggle('mobile', isMobileScreen());
  resize();
  if (loaded) { draw(); updateFrame(); }
}

// ---- Reset ------------------------------------------------------------------
function reset() {
  yaw = pitch = roll = 0; fDst = fSrc;
  frameImgW = 0;
  updateFrame();
  if (typeof updateRollSlider === 'function') updateRollSlider();
}
