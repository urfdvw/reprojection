# Reprojection

A single-file, browser-based tool that reprojects a photograph from its original rectilinear (perspective) capture into any view direction and any output projection — ranging from standard perspective to equidistant fisheye — in real time via WebGL.

Useful for:
- Cropping and re-framing ultra-wide-lens photos without stretching the corners
- Changing the projection model of a photo (perspective → fisheye or anywhere in between)

---

## How to use

Open link to use: https://urfdvw.github.io/reprojection/

Locally, open `index.html` directly in a browser — no server, no build step, no dependencies except an internet connection for the EXIF library.

**Loading an image**

- Drag and drop an image onto the window, or click anywhere to open a file picker.
- Focal length is read automatically from EXIF (`FocalLengthIn35mmFilm`). If absent, an APS-C 1.5× crop factor is assumed. You can override the value in the control panel.

**Controls**

| Input | Action |
|---|---|
| Drag mouse | Pan (yaw / pitch) |
| Arrow keys | Pan (yaw / pitch) |
| `[` / `]` | Roll |
| Scroll wheel | Zoom (change output focal length) |
| Shift + scroll | Roll |
| Horizontal scroll | Roll |
| Alt/Option + scroll | Projection blend (perspective ↔ equidistant) |
| `-` / `=` | Zoom out / in |
| `R` | Reset view |

**Control panel (top-right)**

- **35mm equiv. focal length** — source focal length override; press *Apply* to update.
- **Projection slider** — morphs the output projection from pure perspective (left) to equidistant fisheye (right).
- **Open image** — open a new file.
- **Reset view** — restore yaw, pitch, roll to zero and reset output focal length to match the source.
- **Export frame** — saves a PNG at the original image resolution with the current view applied.

---

## Math

### Coordinate system

The source image is modelled as a pinhole (rectilinear) camera. A pixel at image coordinates $(x, y)$ (origin at image centre) maps to the 3-D ray:

$$
\hat{r} = \left(x,\; y,\; f_\text{src}\right)
$$

where $f_\text{src}$ is the source focal length in pixels, derived from the 35 mm equivalent focal length $F$ and the image long side $L$:

$$
f_\text{src} = F \cdot \frac{L}{36}
$$

### Rotation

Three Euler angles — yaw $\psi$, pitch $\phi$, roll $\rho$ — define the output view direction. The combined rotation matrix is:

$$
R = R_y(\psi)\; R_x(\phi)\; R_z(\rho)
$$

### Output projection (blended fisheye)

For each output pixel at screen offset $\mathbf{s} = (s_x, s_y)$ from the canvas centre (rescaled so the image fills the canvas), let $r = |\mathbf{s}|$ and $f_\text{dst}$ be the output focal length in pixels. The incident angle $\theta$ is:

$$
\theta = (1 - k)\cdot\arctan\!\left(\frac{r}{f_\text{dst}}\right) + k\cdot\frac{r}{f_\text{dst}}
$$

where $k \in [0, 1]$ is the projection blend parameter:

| $k$ | Projection | Mapping law |
|---|---|---|
| 0 | Perspective (rectilinear) | $r = f\tan\theta$ |
| 1 | Equidistant fisheye | $r = f\theta$ |

The corresponding 3-D ray direction (unit-length in $z$ sense) is:

$$
\hat{d} = \left(\frac{\mathbf{s}}{r}\sin\theta,\;\; \cos\theta\right)
$$

This direction is rotated by $R$:

$$
\hat{d}' = R\,\hat{d}
$$

### Back-projection onto source image

The rotated ray $\hat{d}' = (d_x, d_y, d_z)$ is intersected with the source image plane under the pin-hole model. Rays with $d_z \le 0$ fall behind the camera and are rendered as background. For valid rays:

$$
\text{hit} = \frac{f_\text{src}}{d_z}\,(d_x,\, d_y)
$$

$$
\text{uv} = \frac{\text{hit}}{(W, H)} + 0.5
$$

The texture colour at $(u, v)$ is sampled with bilinear filtering.

