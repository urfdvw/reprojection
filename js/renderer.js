/*
 * renderer.js -- WebGL setup, shaders, rendering, and HUD updates.
 *
 * Initialises the WebGL context, compiles the reprojection shaders,
 * and provides the per-frame draw() call and HUD text updates.
 *
 * Provides:
 *   cv, gl          -- canvas element and WebGL context
 *   U               -- uniform location map
 *   tex             -- source image texture
 *   rotMat(y, p, r) -- builds the 3x3 rotation matrix (column-major)
 *   draw()          -- renders the reprojected image for the live preview
 *   updateHUD()     -- refreshes all status bar and sidebar readouts
 *
 * Consumes (from state.js):
 *   loaded, imgW, imgH, fSrc, fDst, yaw, pitch, roll, fisheyeK,
 *   frameImgW, frameImgH, fmtDeg(), setText(), viewW(), viewH()
 */
'use strict';

const cv = document.getElementById('c');
const gl = cv.getContext('webgl', { preserveDrawingBuffer: true })
        || cv.getContext('experimental-webgl', { preserveDrawingBuffer: true });
if (!gl) { alert('WebGL not supported'); }

// ---- Shaders ----------------------------------------------------------------
const VS = 'attribute vec2 a; void main(){gl_Position=vec4(a,0.,1.);}';

const FS = [
  'precision highp float;',
  'uniform sampler2D uTex;',
  'uniform vec2  uRes;',
  'uniform vec2  uImg;',
  'uniform float uFS;',
  'uniform float uFD;',
  'uniform float uK;',
  'uniform mat3  uR;',
  'uniform float uSC;',
  'uniform vec2  uCenter;',
  'uniform vec4  uBg;',
  'void main(){',
  '  vec2 s = (gl_FragCoord.xy - uRes*0.5) / uSC + uCenter;',
  '  float r = length(s);',
  '  vec3 dir;',
  '  if(r < 0.0001){',
  '    dir = vec3(0.0, 0.0, 1.0);',
  '  } else {',
  '    float theta = mix(atan(r / uFD), r / uFD, uK);',
  '    dir = vec3((s / r) * sin(theta), cos(theta));',
  '  }',
  '  vec3 ray = uR * dir;',
  '  if(ray.z <= 0.0){ gl_FragColor = uBg; return; }',
  '  vec2 hit = (uFS/ray.z)*ray.xy;',
  '  vec2 uv  = hit/uImg + 0.5;',
  '  if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.){ gl_FragColor = uBg; return; }',
  '  gl_FragColor = vec4(texture2D(uTex, uv).rgb, 1.0);',
  '}'
].join('\n');

function mkShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error('Shader error: ' + gl.getShaderInfoLog(s));
  return s;
}

const prog = gl.createProgram();
gl.attachShader(prog, mkShader(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, mkShader(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
  throw new Error('Link error: ' + gl.getProgramInfoLog(prog));
gl.useProgram(prog);

gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
const aLoc = gl.getAttribLocation(prog, 'a');
gl.enableVertexAttribArray(aLoc);
gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

const U = {};
['uTex','uRes','uImg','uFS','uFD','uK','uR','uSC','uCenter','uBg'].forEach(n => {
  U[n] = gl.getUniformLocation(prog, n);
});

const tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

// ---- Rotation matrix --------------------------------------------------------
const _rotMat = new Float32Array(9);

function rotMat(y, p, r) {
  const cy=Math.cos(y), sy=Math.sin(y);
  const cp=Math.cos(p), sp=Math.sin(p);
  const cr=Math.cos(r), sr=Math.sin(r);
  _rotMat[0]= cy*cr+sy*sp*sr; _rotMat[1]= cp*sr; _rotMat[2]=-sy*cr+cy*sp*sr;
  _rotMat[3]=-cy*sr+sy*sp*cr; _rotMat[4]= cp*cr; _rotMat[5]= sy*sr+cy*sp*cr;
  _rotMat[6]= sy*cp;          _rotMat[7]=-sp;    _rotMat[8]= cy*cp;
  return _rotMat;
}

// ---- Draw -------------------------------------------------------------------
function draw() {
  if (!loaded) return;
  const sc = Math.min(cv.width / imgW, cv.height / imgH);
  gl.uniform2f(U.uRes, cv.width, cv.height);
  gl.uniform2f(U.uImg, imgW, imgH);
  gl.uniform1f(U.uFS, fSrc);
  gl.uniform1f(U.uFD, fDst);
  gl.uniform1f(U.uK, fisheyeK);
  gl.uniformMatrix3fv(U.uR, false, rotMat(yaw, pitch, roll));
  gl.uniform1f(U.uSC, sc);
  gl.uniform2f(U.uCenter, 0, 0);
  gl.uniform4f(U.uBg, 0, 0, 0, 0);
  gl.uniform1i(U.uTex, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ---- HUD --------------------------------------------------------------------
function updateHUD() {
  const f35eq = loaded ? (fDst * 36 / Math.max(imgW, imgH)).toFixed(0) : '—';
  const projLabel = fisheyeK === 0 ? 'Rectilinear'
                  : fisheyeK === 1 ? 'Equidistant'
                  : 'Blend ' + Math.round(fisheyeK * 100) + '%';
  const fishPct = Math.round(fisheyeK * 100) + '%';
  const minPx = Math.min(imgW, imgH);
  const shortEdge = Math.min(frameImgW, frameImgH);
  const sc = shortEdge > 0 ? minPx / shortEdge : 1;
  const expW = Math.round(frameImgW * sc);
  const expH = Math.round(frameImgH * sc);

  setText('v-yaw',   fmtDeg(yaw));
  setText('v-pitch', fmtDeg(pitch));
  setText('v-roll',  fmtDeg(roll));
  setText('v-focal', loaded ? (f35eq + ' mm') : '— mm');
  setText('v-proj',  projLabel);
  setText('v-export', loaded ? (expW + ' × ' + expH + ' px') : '— × — px');
  setText('v-fisheye',   fishPct);
  setText('v-fisheye-m', fishPct);
}
