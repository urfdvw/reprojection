/*
 * export.js -- JPEG export pipeline.
 *
 * Renders the current frame at full resolution, encodes as JPEG,
 * optionally injects EXIF metadata (preserving original tags and
 * writing the output focal length), and triggers a download. On
 * mobile devices with Web Share API support, offers the native
 * share sheet instead.
 *
 * Provides:
 *   exportFrame() -- async, renders and downloads the cropped frame
 *
 * Consumes (from state.js):
 *   loaded, imgW, imgH, fSrc, fDst, fisheyeK, yaw, pitch, roll,
 *   frameImgX/Y/W/H, loadedFileName, loadedExifObj,
 *   hasPiexif, EMPTY_EXIF, pad(), isMobileDevice()
 * Consumes (from renderer.js):
 *   cv, gl, U, rotMat(), draw()
 */
'use strict';

async function exportFrame() {
  if (!loaded) return;

  const minPx = Math.min(imgW, imgH);
  const shortEdge = Math.min(frameImgW, frameImgH);
  const sc_export = minPx / shortEdge;
  const exportW = Math.round(frameImgW * sc_export);
  const exportH = Math.round(frameImgH * sc_export);

  const cx = frameImgX + frameImgW / 2;
  const cy = -(frameImgY + frameImgH / 2);

  const oldW = cv.width, oldH = cv.height;
  cv.width = exportW; cv.height = exportH;
  gl.viewport(0, 0, exportW, exportH);
  gl.uniform2f(U.uRes, exportW, exportH);
  gl.uniform2f(U.uImg, imgW, imgH);
  gl.uniform1f(U.uFS, fSrc);
  gl.uniform1f(U.uFD, fDst);
  gl.uniform1f(U.uK, fisheyeK);
  gl.uniformMatrix3fv(U.uR, false, rotMat(yaw, pitch, roll));
  gl.uniform1f(U.uSC, sc_export);
  gl.uniform2f(U.uCenter, cx, cy);
  gl.uniform4f(U.uBg, 0.06, 0.06, 0.06, 1.0);
  gl.uniform1i(U.uTex, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  const dataURL = cv.toDataURL('image/jpeg', 0.95);

  cv.width = oldW; cv.height = oldH;
  gl.viewport(0, 0, oldW, oldH);
  draw();

  const now = new Date();
  const dt = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const baseName = loadedFileName.replace(/\.[^.]+$/, '');
  const downloadName = `${baseName}_${dt}.jpg`;

  let jpegBlob;
  if (hasPiexif) {
    try {
      const exif = structuredClone(loadedExifObj ?? EMPTY_EXIF);
      exif['0th'][piexif.ImageIFD.Orientation] = 1;
      delete exif['Exif'][piexif.ExifIFD.FocalLength];
      delete exif['Exif'][piexif.ExifIFD.FocalLengthIn35mmFilm];
      if (fisheyeK === 0) {
        const newF35 = Math.round(fDst * 36 / Math.max(imgW, imgH));
        exif['Exif'][piexif.ExifIFD.FocalLengthIn35mmFilm] = newF35;
        exif['Exif'][piexif.ExifIFD.FocalLength] = [newF35, 1];
      }
      const exifBytes = piexif.dump(exif);
      const newJpeg = piexif.insert(exifBytes, atob(dataURL.split(',')[1]));
      jpegBlob = new Blob([Uint8Array.from(newJpeg, c => c.charCodeAt(0))], { type: 'image/jpeg' });
    } catch (_) {}
  }
  if (!jpegBlob) {
    const binary = atob(dataURL.split(',')[1]);
    jpegBlob = new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], { type: 'image/jpeg' });
  }

  if (isMobileDevice() && navigator.share) {
    const file = new File([jpegBlob], downloadName, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: downloadName });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
  }

  const blobUrl = URL.createObjectURL(jpegBlob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}
