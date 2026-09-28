// WebGL2 post-processing over the Canvas2D renderer (user: "shader effects ... Balatro and other modern pixel
// art games ... lighting and particles, heat haze, etc... more dynamic"). The game still draws everything
// with Canvas2D into a small buffer at game resolution; this takes that buffer (plus a heat mask the renderer
// paints) as textures and does: a bright pass + separable blur at half resolution (real bloom), heat haze
// (wobble where it's hot), and refracting shockwave rings, then scales up to the screen: the scene sampled
// NEAREST so the pixels stay crisp, the bloom LINEAR so the glow is smooth. Returns null if WebGL2 isn't there;
// the renderer then keeps its plain Canvas2D blit. `ok` goes false on context loss (the renderer falls back).

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const BRIGHT = `#version 300 es
precision mediump float;
in vec2 uv; out vec4 o;
uniform sampler2D scene; uniform float thresh;
void main() {
  vec3 c = texture(scene, uv).rgb;
  float l = max(c.r, max(c.g, c.b));
  o = vec4(c * smoothstep(thresh, 1.0, l), 1.0);
}`;

const BLUR = `#version 300 es
precision mediump float;
in vec2 uv; out vec4 o;
uniform sampler2D src; uniform vec2 dir;   // one texel along x or y
void main() {
  vec3 c = texture(src, uv).rgb * 0.227;
  c += (texture(src, uv + dir * 1.385).rgb + texture(src, uv - dir * 1.385).rgb) * 0.316;
  c += (texture(src, uv + dir * 3.231).rgb + texture(src, uv - dir * 3.231).rgb) * 0.070;
  o = vec4(c, 1.0);
}`;

const COMPOSITE = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D scene, bloom, heat;
uniform vec2 buf;        // buffer size in game px
uniform vec3 view;       // S (screen px per game px), fx, fy (sub-pixel camera)
uniform float screenH, time, bloomAmt, haze;
uniform vec4 waves[8];   // shockwaves: x, y (buffer px), radius, strength
uniform int nWaves;
vec2 tex(vec2 px) { return vec2(px.x / buf.x, 1.0 - px.y / buf.y); }   // buffer px (top-left origin) -> texture uv (flipped upload)
void main() {
  vec2 s = vec2(gl_FragCoord.x, screenH - gl_FragCoord.y);
  vec2 px = s / view.x + vec2(1.0) + view.yz;          // the same mapping as the 2D blit
  vec2 off = vec2(0.0);
  for (int i = 0; i < 8; i++) {                         // shockwaves bend the image around a moving ring
    if (i >= nWaves) break;
    vec4 w = waves[i]; vec2 d = px - w.xy; float r = length(d);
    float band = 1.0 - smoothstep(0.0, 5.0, abs(r - w.z));
    off -= (d / max(r, 0.001)) * band * w.w;
  }
  float h = texture(heat, tex(px)).r;                   // heat haze: a wobble where it's hot
  off += h * haze * vec2(sin(px.y * 0.9 + time * 9.0) + 0.6 * sin(px.y * 0.37 - time * 5.3), 0.5 * cos(px.x * 0.7 + time * 7.0));
  vec3 c = texture(scene, tex(px + off)).rgb;
  c += texture(bloom, tex(px)).rgb * bloomAmt;
  o = vec4(c, 1.0);
}`;

export function createCompositor(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const C = { ok: true, gl };
  let P = null;

  function compile(fs) {
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(sh));
      gl.attachShader(prog, sh);
    }
    gl.bindAttribLocation(prog, 0, "p"); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(prog));
    const u = {}; const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(prog, i).name.replace(/\[0\]$/, ""); u[name] = gl.getUniformLocation(prog, name); }
    return { prog, u };
  }
  function texture(filter) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function target(w, h) {
    const t = texture(gl.LINEAR); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, fb, w, h };
  }
  function init() {
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    P = { bright: compile(BRIGHT), blur: compile(BLUR), comp: compile(COMPOSITE), scene: texture(gl.NEAREST), heat: texture(gl.LINEAR), rt: null, bw: 0, bh: 0 };
  }
  function draw(prog, fb, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h); gl.useProgram(prog); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }

  try { init(); } catch (e) { console.error(e); return null; }
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); C.ok = false; });
  canvas.addEventListener("webglcontextrestored", () => { try { init(); C.ok = true; } catch (e) { console.error(e); } });

  /** buf/heat: canvases at game resolution; view: { S, fx, fy }; waves: [[x, y, radius, strength]...] */
  C.render = (buf, heat, view, t, waves, opts) => {
    if (!C.ok) return false;
    const W = canvas.width, H = canvas.height, bw = Math.max(1, buf.width >> 1), bh = Math.max(1, buf.height >> 1);
    if (!P.rt || P.bw !== bw || P.bh !== bh) { P.rt = [target(bw, bh), target(bw, bh)]; P.bw = bw; P.bh = bh; }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, P.scene); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, P.heat); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, heat);
    // bloom: bright pass at half res, then blur across and down (twice, for a wider, softer glow)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, P.scene);
    gl.useProgram(P.bright.prog); gl.uniform1i(P.bright.u.scene, 0); gl.uniform1f(P.bright.u.thresh, opts.thresh);
    draw(P.bright.prog, P.rt[0].fb, bw, bh);
    gl.useProgram(P.blur.prog); gl.uniform1i(P.blur.u.src, 1);
    for (let pass = 0; pass < 2; pass++) {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, P.rt[0].t); gl.useProgram(P.blur.prog); gl.uniform2f(P.blur.u.dir, (1 + pass) / bw, 0); draw(P.blur.prog, P.rt[1].fb, bw, bh);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, P.rt[1].t); gl.useProgram(P.blur.prog); gl.uniform2f(P.blur.u.dir, 0, (1 + pass) / bh); draw(P.blur.prog, P.rt[0].fb, bw, bh);
    }
    // composite to the screen
    const u = P.comp.u;
    gl.useProgram(P.comp.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, P.scene);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, P.rt[0].t);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, P.heat);
    gl.uniform1i(u.scene, 0); gl.uniform1i(u.bloom, 1); gl.uniform1i(u.heat, 2);
    gl.uniform2f(u.buf, buf.width, buf.height); gl.uniform3f(u.view, view.S, view.fx, view.fy);
    gl.uniform1f(u.screenH, H); gl.uniform1f(u.time, t); gl.uniform1f(u.bloomAmt, opts.bloom); gl.uniform1f(u.haze, opts.haze);
    const n = Math.min(8, waves.length), arr = new Float32Array(32);
    for (let i = 0; i < n; i++) arr.set(waves[i], i * 4);
    gl.uniform4fv(u.waves, arr); gl.uniform1i(u.nWaves, n);
    draw(P.comp.prog, null, W, H);
    return true;
  };
  return C;
}
