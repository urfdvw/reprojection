# Reprojection — Architecture

Single-file web application (`index.html`). No build step, no framework. All logic is in one `<script>` block. The entire rendering pipeline runs on the GPU via WebGL.

## External dependencies (CDN)

- **exifr@7 lite** — reads focal length from image EXIF on load
- **piexifjs** — reads and writes raw EXIF byte structure for export

Both are optional at runtime; `hasPiexif` and `typeof exifr !== 'undefined'` guard every use.

---

## Coordinate systems

Three distinct spaces are used throughout. Confusing them is the most common source of bugs.

### Image-pixel space
Origin at the **centre** of the source image, Y-positive = CSS-down (i.e. downward on screen). Unit = one source image pixel. The frame overlay (`frameImgX/Y/W/H`) is stored in this space so it remains stable across viewport resizes and DPR changes. All frame geometry math works here.

### CSS / screen space
Origin top-left, Y-positive = down, unit = logical (non-DPR) pixel. Used only for hit-testing and positioning the `#frame-box` DOM element. Convert to/from image space using `imgScale()` (CSS px per image px).

### WebGL canvas space
Origin bottom-left, Y-positive = up, unit = physical pixel (DPR-scaled). The canvas `.width`/`.height` attributes are set in physical pixels by `resize()`. The fragment shader works in this space internally but immediately converts to image-pixel space via `uSC` and `uCenter`.

---

## Rendering pipeline

### Vertex shader
A full-screen quad (`TRIANGLE_STRIP`, 4 vertices covering `[-1,1]²`). Does nothing except pass through clip-space positions. All work is in the fragment shader.

### Fragment shader — per-pixel reprojection

Each fragment computes which texel from the source image should appear there. Steps:

1. **Screen → image space**
   ```glsl
   vec2 s = (gl_FragCoord.xy - uRes * 0.5) / uSC + uCenter;
   ```
   `uSC` = canvas px per image px (scales from screen to image space). `uCenter` = image-space offset of the viewport centre from the scene centre; it is `(0,0)` during live preview and set to the frame centre during export.

2. **Output projection — image plane → 3D ray direction**
   ```glsl
   float r     = length(s);
   float theta = mix(atan(r / uFD), r / uFD, uK);
   vec3  dir   = vec3((s / r) * sin(theta), cos(theta));
   ```
   `uK` blends between two projection models:
   - `uK = 0` — rectilinear / perspective: `θ = arctan(r / f)`
   - `uK = 1` — equidistant fisheye: `θ = r / f`
   - `0 < uK < 1` — linear blend of the two formulas

   `uFD` is the destination focal length in image pixels. The 3D direction vector is in camera space with Z = forward, Y = up (image Y is flipped — `uCenter` Y sign is negated at call sites to compensate).

3. **Rotation**
   ```glsl
   vec3 ray = uR * dir;
   ```
   `uR` is the 3×3 rotation matrix `Ry(yaw) · Rx(pitch) · Rz(roll)`, stored column-major for WebGL. Computed by `rotMat()` which writes into the reused `_rotMat Float32Array(9)` to avoid per-frame allocation.

4. **Back-project onto source image plane**
   ```glsl
   vec2 hit = (uFS / ray.z) * ray.xy;
   vec2 uv  = hit / uImg + 0.5;
   ```
   Source projection is always rectilinear (pinhole). `uFS` is the source focal length in image pixels. Rays behind the camera (`ray.z ≤ 0`) and UVs outside `[0,1]` render as dark grey `(0.06, 0.06, 0.06)`.

5. **Texture sample** — `texture2D(uTex, uv)`

### Uniform table

| Uniform | Type | Meaning |
|---------|------|---------|
| `uTex` | sampler2D | Source image texture |
| `uRes` | vec2 | Canvas size in physical pixels |
| `uImg` | vec2 | Source image size in pixels |
| `uFS` | float | Source focal length in image pixels |
| `uFD` | float | Destination focal length in image pixels |
| `uK` | float | Projection blend: 0 = perspective, 1 = equidistant |
| `uR` | mat3 | Rotation matrix (column-major) |
| `uSC` | float | Canvas pixels per image pixel |
| `uCenter` | vec2 | Image-space offset of viewport centre (image coords, Y CSS-down) |

---

## Focal length representation

Focal length exists in two forms:

- **35mm equivalent (mm)** — user-visible, shown in the `#f35` input and HUD
- **Image pixels** — used internally by the shader

Conversion: `f_px = f35mm × max(imgW, imgH) / 36`

The constant `36` is the long side of a 35mm full-frame sensor in millimetres. Two separate focal length values are tracked:

- `fSrc` — source image focal length in pixels (set from EXIF on load, adjustable via Apply)
- `fDst` — destination / output focal length in pixels (zoom changes only this)

When the user adjusts the source focal length via Apply, the `fDst/fSrc` ratio is preserved so the zoom level does not jump.

---

## State variables

```
loaded          bool    — whether an image has been loaded
imgW, imgH      int     — source image dimensions in pixels
fSrc, fDst      float   — focal lengths in image pixels (source and destination)
yaw, pitch, roll float  — camera orientation in radians
fisheyeK        float   — projection blend [0, 1]

frameImgX/Y     float   — frame top-left corner in image-pixel space
frameImgW/H     float   — frame dimensions in image-pixel space

loadedFileName  string  — original filename (for export naming)
loadedExifObj   object  — piexifjs EXIF structure parsed from source file, or null
```

Frame resize drag state (`resizeStart*`) stores the frame geometry and pointer position at the moment a drag begins, so `applyFrameResize` / `applyFrameMove` can compute deltas without accumulating floating-point error.

---

## Image loading pipeline (`loadFile`)

1. Store `file.name` → `loadedFileName`
2. If piexifjs is available: read first 64KB of file (`file.slice(0, 65536)`), parse raw EXIF structure → `loadedExifObj` (used later at export to preserve metadata)
3. Parse focal length via exifr: priority order is `FocalLengthIn35mmFilm` → `FocalLengthIn35mmFormat` → `FocalLength35efl` → `FocalLength × 1.5` (APS-C assumption) → default 50mm
4. Create object URL, decode into an `Image` element
5. On `img.onload`: upload to WebGL texture, set `fSrc = fDst = f35mm × max(W,H) / 36`, reset pose, show UI panels, call `draw()` + `updateHUD()` + `updateFrame()`

---

## Frame overlay

`#frame-box` is a `position:fixed` div with CSS `box-shadow: 0 0 0 9999px rgba(0,0,0,0.28)` to dim outside the frame. The eight `.frame-handle` children are absolutely positioned inside it; their CSS `data-dir` attribute encodes which edge(s) they control.

**NW handle** (`data-dir="nw"`, blue square) = **move** handle. All other handles = resize.

Frame geometry is always stored in image-pixel space. `positionFrame()` re-derives CSS `left/top/width/height` from the stable image-space values on every call — no incremental repositioning. This means viewport resizes and mobile rotations are handled for free.

`clampFrame()` constrains `frameImgX/Y` so every corner of the frame remains visible within the viewport.

`applyRatioSnap()` resizes the frame to match the selected aspect ratio from `#frame-ratio`, fitting it within the viewport with a 14px margin.

---

## Export pipeline (`exportFrame`)

1. Compute export resolution: `shortEdge = min(frameImgW, frameImgH)`, `sc_export = min(imgW, imgH) / shortEdge`. This normalises so the short edge of the export is `min(imgW, imgH)` pixels.
2. Resize the WebGL canvas to the export dimensions, set `uCenter` to the frame centre in image-pixel space (with Y negated for WebGL's Y-up convention), render once.
3. `canvas.toDataURL('image/jpeg', 0.95)` → base64 JPEG data URL.
4. Restore canvas to viewport dimensions, re-render for live view.
5. Build filename: `<originalName>_YYYYMMDD_HHMMSS.jpg`
6. EXIF injection (if piexifjs available):
   - Deep-clone `loadedExifObj ?? EMPTY_EXIF` via `structuredClone`
   - Delete `FocalLength` and `FocalLengthIn35mmFilm` from the Exif IFD
   - If `fisheyeK === 0` (strict perspective): write `newF35 = round(fDst × 36 / max(imgW, imgH))` to both fields
   - `piexif.dump()` → `piexif.insert()` → `Uint8Array.from(binary, c => c.charCodeAt(0))` → Blob URL
7. Trigger download via a temporary `<a>` element; revoke Blob URL immediately after click.

---

## Input handling

### Keyboard
`held` Set tracks currently pressed keys. The animation loop polls it every frame to apply continuous rotation/zoom. `R` immediately resets pose. Arrow keys and `- = [ ]` have `preventDefault()` to stop page scrolling.

### Mouse
`mousedown` on canvas starts a pan drag. `mousemove` / `mouseup` are on `document` (not canvas) to keep drag alive when pointer leaves the canvas. When `frameMoving` or `frameResizing` is active, `mousemove` is redirected to `applyFrameMove` / `applyFrameResize` instead.

### Touch
`touchMode` ∈ `{null, 'pan', 'gesture'}`. Single finger = pan (yaw/pitch). Two fingers = gesture (pinch = zoom, rotation = roll). `touchend` on canvas handles finger-count transitions between modes. `touchstart` on frame handles sets `touchMode = null` to cancel any canvas gesture in progress.

Frame move/resize via touch is handled by a separate `document` `touchmove` listener (not the canvas one), mirroring the mouse architecture.

### Scroll wheel
Vertical scroll = zoom (`fDst`). Shift+scroll or horizontal scroll = roll. Alt/Option+scroll = fisheye blend (`fisheyeK`), also syncs the `#fisheye-k` slider.

---

## Animation loop

`requestAnimationFrame` loop runs continuously. When no image is loaded it only resets `prevT`. When an image is loaded it polls `held` for pressed keys, updates state, and calls `draw()` + `updateHUD()` only if something changed (`moved` flag). `dt` is clamped to 100ms to prevent a large jump after the tab regains focus.

---

## Mobile layout

`body.mobile` class is toggled by `syncMobileUI()` based on `mobileQuery.matches` (`max-width: 768px`). When active, `#ctrl` becomes a full-width bottom bar 140px tall. The canvas and `#frame-box` use CSS `inset` to exclude this area.

The 140px height is a shared constant: `--ctrl-h: 140px` in CSS and `MOBILE_CTRL_H = 140` in JS. JS does not read the CSS variable — the two must stay in sync manually. `resize()` and `viewH()` subtract this value so the WebGL canvas and frame overlay are correctly sized.

`syncMobileUI` is called on `resize` events and `mobileQuery change` events, and always calls `resize()` (even before an image is loaded) to keep the canvas dimensions correct.
