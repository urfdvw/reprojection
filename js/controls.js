/*
 * controls.js -- UI event wiring and initialisation.
 *
 * Loaded last. Connects all sidebar controls, buttons, dropdowns,
 * sliders, and frame handles to their respective functions. Also
 * wires up the drag-and-drop zone, file input, help overlay, and
 * mobile mirror controls (which duplicate desktop controls for the
 * compact mobile layout).
 *
 * Provides: nothing (side effects only -- event listener registration)
 *
 * Consumes (from state.js):
 *   loaded, fSrc, fDst, fisheyeK, imgW, imgH,
 *   frameImgX/Y/W/H, frameResizing, frameMoving,
 *   resizeStartX/Y, resizeStartImgX/Y/W/H, resizeHandle,
 *   syncMobileUI(), reset()
 * Consumes (from renderer.js):
 *   draw(), updateHUD()
 * Consumes (from frame.js):
 *   applyRatioSnap(), positionFrame(), applyFrameMove(),
 *   applyFrameResize(), fitFrameToValid(), maybeAutofit(), autofit
 * Consumes (from roll-slider.js):
 *   updateRollSlider()
 * Consumes (from export.js):
 *   exportFrame()
 * Consumes (from loader.js):
 *   loadFile()
 * Consumes (from input.js):
 *   touchMode
 */
'use strict';

// ---- Layout init (must run after renderer.js creates cv/gl) -----------------
resize();
syncMobileUI();
window.addEventListener('resize', syncMobileUI);
mobileQuery.addEventListener('change', syncMobileUI);

// ---- Drag & drop / file open ------------------------------------------------
const dz = document.getElementById('drop-zone');
dz.addEventListener('click', () => document.getElementById('file-in').click());
dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag-over');
  loadFile(e.dataTransfer.files[0]);
});
document.getElementById('file-in').addEventListener('change', e => {
  loadFile(e.target.files[0]); e.target.value = '';
});

// ---- Desktop controls -------------------------------------------------------
document.getElementById('open-btn').addEventListener('click', () =>
  document.getElementById('file-in').click());
document.getElementById('reset-btn').addEventListener('click', () =>
  { reset(); draw(); updateHUD(); });
document.getElementById('export-btn').addEventListener('click', exportFrame);
document.getElementById('apply-btn').addEventListener('click', () => {
  const f = parseFloat(document.getElementById('f35').value);
  if (!f || f <= 0) return;
  const ratio = fDst / fSrc;
  fSrc = f * Math.max(imgW, imgH) / 36;
  fDst = fSrc * ratio;
  const m = document.getElementById('f35-m'); if (m) m.value = Math.round(f);
  draw(); updateHUD(); maybeAutofit();
});
document.getElementById('fisheye-k').addEventListener('input', e => {
  fisheyeK = parseFloat(e.target.value);
  const m = document.getElementById('fisheye-k-m'); if (m) m.value = fisheyeK;
  draw(); updateHUD(); maybeAutofit();
});

document.getElementById('frame-ratio').addEventListener('change', () => {
  const m = document.getElementById('frame-ratio-m');
  if (m) m.value = document.getElementById('frame-ratio').value;
  if (autofit) { fitFrameToValid(); }
  else { applyRatioSnap(); positionFrame(); }
  updateHUD();
});

// ---- Mobile mirror controls -------------------------------------------------
const fkM = document.getElementById('fisheye-k-m');
if (fkM) fkM.addEventListener('input', e => {
  fisheyeK = parseFloat(e.target.value);
  document.getElementById('fisheye-k').value = fisheyeK;
  draw(); updateHUD(); maybeAutofit();
});

const f35M = document.getElementById('f35-m');
if (f35M) f35M.addEventListener('change', () => {
  const f = parseFloat(f35M.value);
  if (!f || f <= 0) return;
  document.getElementById('f35').value = f;
  if (loaded) {
    const ratio = fDst / fSrc;
    fSrc = f * Math.max(imgW, imgH) / 36;
    fDst = fSrc * ratio;
    draw(); updateHUD();
  }
});

const rM = document.getElementById('frame-ratio-m');
if (rM) rM.addEventListener('change', () => {
  document.getElementById('frame-ratio').value = rM.value;
  if (autofit) { fitFrameToValid(); }
  else { applyRatioSnap(); positionFrame(); }
  updateHUD();
});

// ---- Fit-to-image controls --------------------------------------------------
const fitBtn = document.getElementById('fit-btn');
if (fitBtn) fitBtn.addEventListener('click', () => fitFrameToValid());
const fitBtnM = document.getElementById('fit-btn-m');
if (fitBtnM) fitBtnM.addEventListener('click', () => fitFrameToValid());
const autofitChk = document.getElementById('autofit-chk');
if (autofitChk) autofitChk.addEventListener('change', () => {
  autofit = autofitChk.checked;
  if (autofit) fitFrameToValid();
});

const resetM = document.getElementById('reset-btn-m');
if (resetM) resetM.addEventListener('click', () => { reset(); draw(); updateHUD(); });
const openM = document.getElementById('open-btn-m');
if (openM) openM.addEventListener('click', () => document.getElementById('file-in').click());
const expM = document.getElementById('export-btn-m');
if (expM) expM.addEventListener('click', exportFrame);

// ---- Help overlay -----------------------------------------------------------
const helpToggle = document.getElementById('help-toggle');
const helpOverlay = document.getElementById('help-overlay');
if (helpToggle && helpOverlay) {
  helpToggle.addEventListener('click', () => helpOverlay.classList.toggle('show'));
  helpOverlay.addEventListener('click', () => helpOverlay.classList.remove('show'));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') helpOverlay.classList.remove('show');
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) helpOverlay.classList.toggle('show');
  });
}

// ---- Frame handles ----------------------------------------------------------
document.querySelectorAll('.frame-handle').forEach(handle => {
  function startHandle(cx, cy) {
    resizeStartX     = cx; resizeStartY     = cy;
    resizeStartImgX  = frameImgX; resizeStartImgY  = frameImgY;
    resizeStartImgW  = frameImgW; resizeStartImgH  = frameImgH;
    if (handle.dataset.dir === 'nw') {
      frameMoving = true;
      document.body.style.cursor = 'move';
    } else {
      frameResizing = true;
      resizeHandle  = handle.dataset.dir;
      document.body.style.cursor = window.getComputedStyle(handle).cursor;
    }
  }
  handle.addEventListener('mousedown', e => {
    if (!loaded) return;
    e.stopPropagation(); e.preventDefault();
    startHandle(e.clientX, e.clientY);
  });
  handle.addEventListener('touchstart', e => {
    if (!loaded) return;
    e.stopPropagation();
    touchMode = null;
    startHandle(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
});

document.addEventListener('touchmove', e => {
  if (!frameMoving && !frameResizing) return;
  e.preventDefault();
  const t = e.touches[0];
  if (frameMoving) applyFrameMove(t.clientX, t.clientY);
  else applyFrameResize(t.clientX - resizeStartX, t.clientY - resizeStartY);
}, { passive: false });

document.addEventListener('touchend', () => { frameResizing = false; frameMoving = false; });

// ---- Initialise HUD --------------------------------------------------------
updateHUD();
updateRollSlider();
