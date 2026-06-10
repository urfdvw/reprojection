/*
 * loader.js -- Image loading and EXIF focal-length parsing.
 *
 * Handles loading an image file into the WebGL texture, reading EXIF
 * metadata for focal length detection, and initialising the viewport
 * state for the newly loaded image.
 *
 * Focal length priority: FocalLengthIn35mmFilm > FocalLengthIn35mmFormat
 * > FocalLength35efl > FocalLength * 1.5 (APS-C assumption) > 50mm default.
 *
 * Provides:
 *   loadFile(file) -- async, loads an image File into the app
 *
 * Consumes (from state.js):
 *   loaded, imgW, imgH, fSrc, fDst, yaw, pitch, roll,
 *   loadedFileName, loadedExifObj, hasPiexif
 * Consumes (from renderer.js):
 *   gl, tex, draw(), updateHUD()
 * Consumes (from frame.js):
 *   updateFrame()
 */
'use strict';

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;

  loadedFileName = file.name;
  loadedExifObj = null;
  if (hasPiexif) {
    try {
      const bytes = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
      loadedExifObj = piexif.load(Array.from(bytes, b => String.fromCharCode(b)).join(''));
    } catch (_) {}
  }

  let f35 = 50;
  try {
    if (typeof exifr !== 'undefined') {
      const exif = await exifr.parse(file);
      if (exif) {
        const equiv = exif.FocalLengthIn35mmFilm
                   || exif.FocalLengthIn35mmFormat
                   || exif.FocalLength35efl;
        if (equiv) {
          f35 = equiv;
        } else if (exif.FocalLength) {
          f35 = exif.FocalLength * 1.5;
        }
      }
    }
  } catch (_) {}

  const url = URL.createObjectURL(file);
  const img = new Image();

  img.onload = () => {
    imgW = img.naturalWidth;
    imgH = img.naturalHeight;
    fSrc = f35 * Math.max(imgW, imgH) / 36;
    fDst = fSrc;
    yaw = pitch = roll = 0;

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    URL.revokeObjectURL(url);

    loaded = true;
    frameImgW = 0;
    document.getElementById('drop-zone').classList.add('hidden');
    document.getElementById('f35').value = Math.round(f35);
    const f35m = document.getElementById('f35-m'); if (f35m) f35m.value = Math.round(f35);
    const fl = document.getElementById('filename-label'); if (fl) fl.textContent = file.name;
    draw();
    updateHUD();
    updateFrame();
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}
