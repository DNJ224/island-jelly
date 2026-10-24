import { PALETTES, SUN } from './world.js';
import { drawingBuffer, sunMatrix, writeBodies, writeUniforms } from './uniforms.js';
import { glslSources } from './glsl.js';

const STATIC = [
  ['terrain', 0],
  ['soil', 1],
  ['leaves', 2],
  ['trunks', 3],
];

export function createWebGLRenderer(canvas, geo, quality, view) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false,
    premultipliedAlpha: false,
  });
  if (!gl) throw new Error('no webgl2');
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('OES_texture_float_linear');
  const floatRT = probeFloat(gl);
  const src = glslSources(floatRT);
  const programs = {
    mesh: link(gl, src.meshVS, src.meshFS),
    shadow: link(gl, src.shadowVS, src.shadowFS),
    background: link(gl, src.backgroundVS, src.backgroundFS),
    water: link(gl, src.waterVS, src.waterFS),
    back: link(gl, src.waterVS, src.backFS),
    caustic: link(gl, src.causticVS, src.causticFS),
    copy: link(gl, src.copyVS, src.copyFS),
    final: link(gl, src.finalVS, src.finalFS),
  };
  for (const program of Object.values(programs)) bindSamplers(gl, program);

  const ubo = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
  gl.bufferData(gl.UNIFORM_BUFFER, 768, gl.DYNAMIC_DRAW);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
  const uniforms = new Float32Array(192);
  const bodies = new Float32Array(400 * 8);
  const fullVAO = gl.createVertexArray();
  const meshes = {
    water: uploadMesh(gl, geo.meshes.water, null),
    walls: uploadMesh(gl, geo.meshes.walls, null),
    sphere: uploadMesh(gl, geo.meshes.sphere, null),
  };
  for (const [name, kind] of STATIC) meshes[name] = uploadMesh(gl, geo.meshes[name], kind);
  const sphereBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuf);
  gl.bufferData(gl.ARRAY_BUFFER, bodies.byteLength, gl.DYNAMIC_DRAW);
  gl.bindVertexArray(meshes.sphere.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuf);
  enableInstance(gl);
  gl.bindVertexArray(null);

  const waveTex = allocWaves(gl, quality.gn);
  const renderer = {
    backend: 'webgl',
    zMode: 'webgl',
    canvas,
    width: 0,
    height: 0,
    dpr: 1,
    cpuMs: 0,
    frameCount: 0,
    errors: [],
    budget: quality.pixels,
    shadowSize: quality.shadow,
    causticSize: quality.caustics,
    sunVP: sunMatrix('webgl'),
    floatRT,
    targets: null,
    render(sim) {
      const start = performance.now();
      ensureTargets(gl, renderer);
      view.zMode = 'webgl';
      view.update();
      const counts = writeBodies(sim, bodies);
      gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, bodies.subarray(0, counts.count * 8));
      writeUniforms(uniforms, {
        view,
        sim,
        palette: PALETTES[sim.palette],
        width: renderer.width,
        height: renderer.height,
        dpr: renderer.dpr,
        sun: SUN,
        sunVP: renderer.sunVP,
        shadowSize: renderer.shadowSize,
        shafts: quality.shafts,
        gn: sim.water.n,
        gdx: sim.water.gdx,
      });
      gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, uniforms);
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
      gl.bindTexture(gl.TEXTURE_2D, waveTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, quality.gn, quality.gn, gl.RGBA, gl.FLOAT, sim.water.pack());

      const t = renderer.targets;
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.colorMask(false, false, false, false);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.5, 2);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.shadowFbo);
      gl.viewport(0, 0, renderer.shadowSize, renderer.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(programs.shadow);
      drawNamed(gl, meshes, ['terrain', 'soil', 'trunks', 'leaves']);
      drawSphere(gl, meshes.sphere, counts.shadow);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.colorMask(true, true, true, true);

      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.causticFbo);
      gl.viewport(0, 0, renderer.causticSize, renderer.causticSize);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(programs.caustic);
      drawElements(gl, meshes.water);
      gl.disable(gl.BLEND);

      bindAll(gl, waveTex, t, t.opaque);
      gl.enable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.opaqueFbo);
      gl.viewport(0, 0, renderer.width, renderer.height);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.clearColor(0.83, 0.803, 0.756, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.depthFunc(gl.ALWAYS);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(programs.background);
      gl.bindVertexArray(fullVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.useProgram(programs.mesh);
      drawNamed(gl, meshes, ['terrain', 'soil', 'trunks', 'leaves']);
      drawSphere(gl, meshes.sphere, counts.count);

      gl.bindFramebuffer(gl.FRAMEBUFFER, t.backFbo);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.clearColor(1000, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.cullFace(gl.FRONT);
      gl.useProgram(programs.back);
      drawElements(gl, meshes.water);
      drawElements(gl, meshes.walls);

      bindAll(gl, waveTex, t, t.opaque);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.sceneFbo);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.depthFunc(gl.ALWAYS);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(programs.copy);
      gl.bindVertexArray(fullVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthFunc(gl.LESS);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.useProgram(programs.water);
      drawElements(gl, meshes.water);
      drawElements(gl, meshes.walls);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, renderer.width, renderer.height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, t.scene);
      gl.useProgram(programs.final);
      gl.bindVertexArray(fullVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);

      renderer.frameCount++;
      const elapsed = performance.now() - start;
      renderer.cpuMs = renderer.frameCount === 1 ? elapsed : renderer.cpuMs * 0.9 + elapsed * 0.1;
      if (renderer.frameCount === 6 && renderer.cpuMs > 34 && renderer.budget > 700000) {
        renderer.budget = Math.max(600000, renderer.budget * 0.62);
        renderer.width = 0;
      }
    },
  };
  view.zMode = 'webgl';
  return renderer;
}

function probeFloat(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, 4, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = !gl.getError() && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(tex);
  return ok;
}

function link(gl, vsSource, fsSource) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'link');
  const block = gl.getUniformBlockIndex(program, 'Globals');
  if (block !== 0xffffffff) gl.uniformBlockBinding(program, block, 0);
  return program;
}

function compile(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'compile');
  return sh;
}

function bindSamplers(gl, program) {
  gl.useProgram(program);
  ['waves', 'shadowMap', 'caustics', 'opaqueColor', 'opaqueDistance', 'backDistance'].forEach((name, i) => {
    const loc = gl.getUniformLocation(program, name);
    if (loc) gl.uniform1i(loc, i);
  });
}

function allocWaves(gl, gn) {
  gl.getError();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, gn, gn);
  if (gl.getError()) {
    gl.deleteTexture(tex);
    const fallback = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fallback);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, gn, gn);
    if (gl.getError()) throw new Error('wave texture');
    return fallback;
  }
  return tex;
}

function uploadMesh(gl, mesh, kind) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  const stride = 48;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 32);
  if (kind !== null) {
    const instance = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instance);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, kind, 0, 0, 0]), gl.STATIC_DRAW);
    enableInstance(gl);
  }
  gl.bindVertexArray(null);
  return { vao, count: mesh.indices.length };
}

function enableInstance(gl) {
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 32, 0);
  gl.vertexAttribDivisor(4, 1);
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 32, 16);
  gl.vertexAttribDivisor(5, 1);
}

function drawNamed(gl, meshes, names) {
  for (const name of names) {
    const mesh = meshes[name];
    gl.bindVertexArray(mesh.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0, 1);
  }
}

function drawElements(gl, mesh) {
  gl.bindVertexArray(mesh.vao);
  gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
}

function drawSphere(gl, mesh, count) {
  if (!count) return;
  gl.bindVertexArray(mesh.vao);
  gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0, count);
}

function ensureTargets(gl, renderer) {
  const buf = drawingBuffer(renderer.canvas, renderer.budget);
  if (renderer.targets && buf.w === renderer.width && buf.h === renderer.height) return;
  renderer.width = buf.w;
  renderer.height = buf.h;
  renderer.dpr = buf.dpr;
  gl.canvas.width = buf.w;
  gl.canvas.height = buf.h;
  if (renderer.targets) destroyTargets(gl, renderer.targets);
  renderer.targets = buildTargets(gl, buf.w, buf.h, renderer.shadowSize, renderer.causticSize, renderer.floatRT);
}

function destroyTargets(gl, t) {
  for (const tex of [t.opaque, t.distance, t.scene, t.back, t.shadow, t.caustic]) gl.deleteTexture(tex);
  for (const fb of [t.opaqueFbo, t.backFbo, t.sceneFbo, t.shadowFbo, t.causticFbo]) gl.deleteFramebuffer(fb);
  gl.deleteRenderbuffer(t.depth);
  gl.deleteRenderbuffer(t.backDepth);
}

function buildTargets(gl, w, h, shadowSize, causticSize, floatRT) {
  const internal = floatRT ? gl.RGBA16F : gl.RGBA8;
  const opaque = sized(gl, internal, w, h, true);
  const distance = sized(gl, internal, w, h, false);
  const scene = sized(gl, internal, w, h, true);
  const back = sized(gl, internal, w, h, false);
  const caustic = sized(gl, internal, causticSize, causticSize, true);
  const shadow = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadow);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, shadowSize, shadowSize);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);

  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
  const backDepth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, backDepth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);

  const shadowFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadow, 0);
  gl.drawBuffers([gl.NONE]);
  status(gl, 'shadow');

  const causticFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, causticFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, caustic, 0);
  status(gl, 'caustic');

  const opaqueFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, opaqueFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, opaque, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, distance, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  status(gl, 'opaque');

  const backFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, backFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, back, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, backDepth);
  status(gl, 'back');

  const sceneFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scene, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  status(gl, 'scene');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { opaque, distance, scene, back, shadow, caustic, depth, backDepth, shadowFbo, causticFbo, opaqueFbo, backFbo, sceneFbo };
}

function sized(gl, internal, w, h, linear) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
  const filter = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function status(gl, name) {
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer ' + name);
}

function bindAll(gl, wave, t, color) {
  const list = [wave, t.shadow, t.caustic, color, t.distance, t.back];
  for (let i = 0; i < list.length; i++) {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, list[i]);
  }
}
