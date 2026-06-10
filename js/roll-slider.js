/*
 * roll-slider.js -- Infinite roll slider widget (desktop only).
 *
 * Renders a horizontal slider with scrolling tick marks and a fixed
 * centre indicator ("ping"). Dragging left/right changes the roll
 * angle proportionally to mouse displacement. Double-click resets
 * roll to zero. The tick marks scroll to reflect the current roll
 * value, creating an infinite-slider feel.
 *
 * Provides:
 *   updateRollSlider() -- redraws ticks and updates the value readout
 *
 * Consumes (from state.js):
 *   roll
 * Consumes (from renderer.js):
 *   draw(), updateHUD()
 * Consumes (from frame.js):
 *   maybeAutofit()
 */
'use strict';

const rollSliderEl     = document.getElementById('roll-slider');
const rollSliderCanvas = document.getElementById('roll-slider-ticks');
const rollSliderValue  = document.getElementById('roll-slider-value');
let rollDragging = false;
let rollDragLastX = 0;
const ROLL_DRAG_SENS = 0.005;

function drawRollTicks() {
  const cvs = rollSliderCanvas;
  const rect = rollSliderEl.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  const w = rect.width, h = rect.height;
  cvs.width = Math.round(w * dpr);
  cvs.height = Math.round(h * dpr);
  cvs.style.width = w + 'px';
  cvs.style.height = h + 'px';

  const ctx = cvs.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const rollDeg = roll * 180 / Math.PI;
  const pxPerDeg = 4;
  const offset = (rollDeg * pxPerDeg) % 10;
  const centre = w / 2;

  ctx.lineWidth = 1;

  for (let x = -centre - 20; x <= centre + 20; x += 1) {
    const px = centre - offset + x;
    if (px < 0 || px > w) continue;
    const degAtTick = (x + rollDeg * pxPerDeg) / pxPerDeg;
    const mod5 = Math.round(degAtTick * 10) % 50;
    const mod10 = Math.round(degAtTick * 10) % 100;

    if (Math.abs(mod10) < 1) {
      ctx.strokeStyle = 'rgba(212,212,212,0.5)';
      ctx.beginPath();
      ctx.moveTo(px, 4);
      ctx.lineTo(px, h - 4);
      ctx.stroke();
    } else if (Math.abs(mod5) < 1) {
      ctx.strokeStyle = 'rgba(142,142,142,0.35)';
      ctx.beginPath();
      ctx.moveTo(px, 8);
      ctx.lineTo(px, h - 8);
      ctx.stroke();
    } else if (Math.abs(Math.round(degAtTick * 10) % 10) < 1) {
      ctx.strokeStyle = 'rgba(90,90,90,0.25)';
      ctx.beginPath();
      ctx.moveTo(px, 11);
      ctx.lineTo(px, h - 11);
      ctx.stroke();
    }
  }
}

function updateRollSlider() {
  drawRollTicks();
  if (rollSliderValue) {
    rollSliderValue.textContent = (roll * 180 / Math.PI).toFixed(1) + '°';
  }
}

if (rollSliderEl) {
  rollSliderEl.addEventListener('mousedown', e => {
    rollDragging = true;
    rollDragLastX = e.clientX;
    e.preventDefault();
    document.body.style.cursor = 'ew-resize';
  });

  document.addEventListener('mousemove', e => {
    if (!rollDragging) return;
    const dx = e.clientX - rollDragLastX;
    rollDragLastX = e.clientX;
    roll += dx * ROLL_DRAG_SENS;
    updateRollSlider();
    draw(); updateHUD(); maybeAutofit();
  });

  document.addEventListener('mouseup', () => {
    if (rollDragging) {
      rollDragging = false;
      document.body.style.cursor = '';
    }
  });

  rollSliderEl.addEventListener('dblclick', () => {
    roll = 0;
    updateRollSlider();
    draw(); updateHUD(); maybeAutofit();
  });

  new ResizeObserver(() => updateRollSlider()).observe(rollSliderEl);
}

updateRollSlider();
