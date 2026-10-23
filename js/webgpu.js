import { PALETTES, SUN } from './world.js';
import { drawingBuffer, sunMatrix, writeBodies, writeUniforms } from './uniforms.js';
import { WGSL } from './wgsl.js';

const STATIC = [
  ['terrain', 0],
  ['soil', 1],
  ['leaves', 2],
  ['trunks', 3],
];

export async function createWebGPURenderer(canvas, geo, quality, view, onFatal) {
  if (!navigator.gpu) throw new Error('no webgpu');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('no adapter');
  const adapterInfo = adapter.info || {};
  // This Chrome build cannot present a SwiftShader WebGPU swapchain (the shared-image
  // factory is missing, and the device is destroyed after a few frames). Render the
  // same passes and blit the finished image onto a 2D canvas instead.
  const readback = /swiftshader|llvmpipe|softpipe|software/i.test(
    `${adapterInfo.architecture || ''} ${adapterInfo.vendor || ''} ${adapterInfo.device || ''} ${adapterInfo.description || ''}`,
  );
  const device = await adapter.requestDevice();
  const module = device.createShaderModule({ code: WGSL });
  const info = await module.getCompilationInfo();
  const messages = info.messages.filter((m) => m.type === 'error');
  if (messages.length) {
    device.destroy();
    throw new Error(messages.map((m) => m.message).join('\n'));
  }

  const format = readback ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat();
  // WebGPU sample counts are 1 or 4, and 4 is not available for every float target.
  // One sample keeps the same shading on both backends without an invalid texture.
  const samples = 1;
  const meshBuffers = [
    {
      arrayStride: 48,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x2' },
        { shaderLocation: 3, offset: 32, format: 'float32x4' },
      ],
    },
    {
      arrayStride: 32,
      stepMode: 'instance',
      attributes: [
        { shaderLocation: 4, offset: 0, format: 'float32x4' },
        { shaderLocation: 5, offset: 16, format: 'float32x4' },
      ],
    },
  ];
  const VVF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const VF = GPUShaderStage.FRAGMENT;
  const uniformEntry = { binding: 0, visibility: VVF, buffer: { type: 'uniform' } };
  const waveEntry = { binding: 1, visibility: VVF, texture: { sampleType: 'unfilterable-float' } };
  const uniformBGL = device.createBindGroupLayout({ entries: [uniformEntry] });
  const wavesBGL = device.createBindGroupLayout({ entries: [uniformEntry, waveEntry] });
  const backdropBGL = device.createBindGroupLayout({
    entries: [
      uniformEntry,
      waveEntry,
      { binding: 4, visibility: VF, texture: { sampleType: 'float' } },
      { binding: 5, visibility: VF, sampler: { type: 'filtering' } },
    ],
  });
  const meshBGL = device.createBindGroupLayout({
    entries: [
      uniformEntry,
      waveEntry,
      { binding: 2, visibility: VF, texture: { sampleType: 'depth' } },
      { binding: 3, visibility: VF, sampler: { type: 'comparison' } },
      { binding: 4, visibility: VF, texture: { sampleType: 'float' } },
      { binding: 5, visibility: VF, sampler: { type: 'filtering' } },
    ],
  });
  const copyBGL = device.createBindGroupLayout({
    entries: [
      { binding: 5, visibility: VF, sampler: { type: 'filtering' } },
      { binding: 6, visibility: VF, texture: { sampleType: 'float' } },
    ],
  });
  const waterBGL = device.createBindGroupLayout({
    entries: [
      uniformEntry,
      waveEntry,
      { binding: 2, visibility: VF, texture: { sampleType: 'depth' } },
      { binding: 3, visibility: VF, sampler: { type: 'comparison' } },
      { binding: 4, visibility: VF, texture: { sampleType: 'float' } },
      { binding: 5, visibility: VF, sampler: { type: 'filtering' } },
      { binding: 6, visibility: VF, texture: { sampleType: 'float' } },
      { binding: 7, visibility: VF, texture: { sampleType: 'unfilterable-float' } },
      { binding: 8, visibility: VF, texture: { sampleType: 'unfilterable-float' } },
    ],
  });
  const finalBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: VF, texture: { sampleType: 'float' } },
      { binding: 1, visibility: VF, sampler: { type: 'filtering' } },
    ],
  });
  const emptyBGL = device.createBindGroupLayout({ entries: [] });
  const layouts = {
    uniform: device.createPipelineLayout({ bindGroupLayouts: [uniformBGL] }),
    waves: device.createPipelineLayout({ bindGroupLayouts: [wavesBGL] }),
    backdrop: device.createPipelineLayout({ bindGroupLayouts: [backdropBGL] }),
    mesh: device.createPipelineLayout({ bindGroupLayouts: [meshBGL] }),
    copy: device.createPipelineLayout({ bindGroupLayouts: [copyBGL] }),
    water: device.createPipelineLayout({ bindGroupLayouts: [waterBGL] }),
    final: device.createPipelineLayout({ bindGroupLayouts: [emptyBGL, finalBGL] }),
  };
  const additive = {
    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  };
  const depthOn = (formatName, write, compare = 'less') => ({
    format: formatName,
    depthWriteEnabled: write,
    depthCompare: compare,
  });

  let pipelines;
  try {
    pipelines = await buildPipelines(device, module, layouts, meshBuffers, samples, format, depthOn, additive);
  } catch (error) {
    device.destroy();
    throw error;
  }

  const first = drawingBuffer(canvas, quality.pixels);
  canvas.width = first.w;
  canvas.height = first.h;
  let context = null;
  let ctx2d = null;
  if (readback) {
    ctx2d = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx2d) {
      device.destroy();
      throw new Error('no 2d context');
    }
  } else {
    context = canvas.getContext('webgpu');
    if (!context) {
      device.destroy();
      throw new Error('no webgpu context');
    }
    context.configure({ device, format, alphaMode: 'opaque' });
  }

  const linear = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const compare = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
  const uniform = device.createBuffer({ size: 768, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uniforms = new Float32Array(192);
  const bodies = new Float32Array(400 * 8);
  const instance = device.createBuffer({ size: bodies.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const gn = quality.gn;
  const rowBytes = gn * 16;
  const padded = Math.ceil(rowBytes / 256) * 256;
  const wavePad = padded === rowBytes ? null : new Uint8Array(padded * gn);
  const waveTex = device.createTexture({
    size: [gn, gn],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const meshes = {};
  for (const [name, kind] of STATIC) meshes[name] = gpuMesh(device, geo.meshes[name], kind);
  meshes.water = gpuMesh(device, geo.meshes.water, null);
  meshes.walls = gpuMesh(device, geo.meshes.walls, null);
  meshes.sphere = gpuMesh(device, geo.meshes.sphere, null);

  const shadowTex = device.createTexture({
    size: [quality.shadow, quality.shadow],
    format: 'depth32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const shadowView = shadowTex.createView();
  const causticTex = device.createTexture({
    size: [quality.caustics, quality.caustics],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const causticView = causticTex.createView();
  const waveView = waveTex.createView();
  const uniformBind = device.createBindGroup({ layout: uniformBGL, entries: [{ binding: 0, resource: { buffer: uniform } }] });
  const wavesBind = device.createBindGroup({
    layout: wavesBGL,
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: waveView },
    ],
  });
  const backdropBind = device.createBindGroup({
    layout: backdropBGL,
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: waveView },
      { binding: 4, resource: causticView },
      { binding: 5, resource: linear },
    ],
  });
  const meshBind = device.createBindGroup({
    layout: meshBGL,
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: waveView },
      { binding: 2, resource: shadowView },
      { binding: 3, resource: compare },
      { binding: 4, resource: causticView },
      { binding: 5, resource: linear },
    ],
  });

  const renderer = {
    backend: 'webgpu',
    zMode: 'webgpu',
    canvas,
    width: 0,
    height: 0,
    dpr: 1,
    cpuMs: 0,
    frameCount: 0,
    errors: [],
    budget: quality.pixels,
    samples,
    sunVP: sunMatrix('webgpu'),
    targets: null,
    lost: false,
    device,
    context,
    readback,
    ctx2d,
    chain: Promise.resolve(),
    pending: 0,
    pixels: null,
    render(sim) {
      const job = renderer.chain.then(() => renderFrame(sim));
      renderer.pending++;
      const settled = job.then(
        () => {},
        (error) => {
          if (renderer.errors.length < 8) renderer.errors.push(String(error?.message || error));
        },
      );
      renderer.chain = settled;
      return settled.finally(() => {
        renderer.pending--;
      });
    },
  };

  function renderFrame(sim) {
      if (renderer.lost) return Promise.resolve();
      const start = performance.now();
      ensureTargets(device, renderer, samples);
      view.zMode = 'webgpu';
      view.update();
      const counts = writeBodies(sim, bodies);
      if (counts.count) device.queue.writeBuffer(instance, 0, bodies.subarray(0, counts.count * 8));
      writeUniforms(uniforms, {
        view,
        sim,
        palette: PALETTES[sim.palette],
        width: renderer.width,
        height: renderer.height,
        dpr: renderer.dpr,
        sun: SUN,
        sunVP: renderer.sunVP,
        shadowSize: quality.shadow,
        shafts: quality.shafts,
        gn: sim.water.n,
        gdx: sim.water.gdx,
      });
      device.queue.writeBuffer(uniform, 0, uniforms);
      uploadWaves(device, waveTex, sim.water.pack(), gn, rowBytes, padded, wavePad);
      const t = renderer.targets;
      if (!t.waterBind) {
        t.waterBind = device.createBindGroup({
          layout: waterBGL,
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: waveView },
            { binding: 2, resource: shadowView },
            { binding: 3, resource: compare },
            { binding: 4, resource: causticView },
            { binding: 5, resource: linear },
            { binding: 6, resource: t.opaqueView },
            { binding: 7, resource: t.distanceView },
            { binding: 8, resource: t.backSample },
          ],
        });
        t.copyBind = device.createBindGroup({
          layout: copyBGL,
          entries: [
            { binding: 5, resource: linear },
            { binding: 6, resource: t.opaqueView },
          ],
        });
        t.finalBind = device.createBindGroup({
          layout: finalBGL,
          entries: [
            { binding: 0, resource: t.sceneSample },
            { binding: 1, resource: linear },
          ],
        });
      }
      const encoder = device.createCommandEncoder();
      const shadowPass = encoder.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: {
          view: shadowView,
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      shadowPass.setPipeline(pipelines.shadow);
      shadowPass.setBindGroup(0, uniformBind);
      drawStatic(shadowPass, meshes, ['terrain', 'soil', 'trunks', 'leaves']);
      drawSphere(shadowPass, meshes.sphere, instance, counts.shadow);
      shadowPass.end();

      const causticPass = encoder.beginRenderPass({
        colorAttachments: [{ view: causticView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
      });
      causticPass.setPipeline(pipelines.caustic);
      causticPass.setBindGroup(0, wavesBind);
      drawMesh(causticPass, meshes.water, meshes.water.instance, 1);
      causticPass.end();

      const opaquePass = encoder.beginRenderPass({
        colorAttachments: [
          attach(t.colorView, t.colorResolve, { r: 0, g: 0, b: 0, a: 1 }),
          attach(t.distView, t.distResolve, { r: 1000, g: 0, b: 0, a: 1 }),
        ],
        depthStencilAttachment: {
          view: t.depthView,
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      opaquePass.setPipeline(pipelines.background);
      opaquePass.setBindGroup(0, backdropBind);
      opaquePass.draw(3);
      opaquePass.setPipeline(pipelines.mesh);
      opaquePass.setBindGroup(0, meshBind);
      drawStatic(opaquePass, meshes, ['terrain', 'soil', 'trunks', 'leaves']);
      drawSphere(opaquePass, meshes.sphere, instance, counts.count);
      opaquePass.end();

      const backPass = encoder.beginRenderPass({
        colorAttachments: [attach(t.backView, null, { r: 1000, g: 0, b: 0, a: 1 }, 'store')],
        depthStencilAttachment: {
          view: t.backDepthView,
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
        },
      });
      backPass.setPipeline(pipelines.back);
      backPass.setBindGroup(0, wavesBind);
      drawMesh(backPass, meshes.water, meshes.water.instance, 1);
      drawMesh(backPass, meshes.walls, meshes.walls.instance, 1);
      backPass.end();

      const scenePass = encoder.beginRenderPass({
        colorAttachments: [attach(t.sceneView, t.sceneResolve, { r: 0, g: 0, b: 0, a: 1 })],
        depthStencilAttachment: {
          view: t.depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'discard',
        },
      });
      scenePass.setPipeline(pipelines.copy);
      scenePass.setBindGroup(0, t.copyBind);
      scenePass.draw(3);
      scenePass.setPipeline(pipelines.water);
      scenePass.setBindGroup(0, t.waterBind);
      drawMesh(scenePass, meshes.water, meshes.water.instance, 1);
      drawMesh(scenePass, meshes.walls, meshes.walls.instance, 1);
      scenePass.end();

      let finalView;
      if (renderer.readback) {
        finalView = t.presentView;
      } else {
        const canvasTexture = context.getCurrentTexture();
        finalView = canvasTexture.createView();
        renderer.presented = finalView;
      }
      const finalPass = encoder.beginRenderPass({
        colorAttachments: [{ view: finalView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      });
      finalPass.setPipeline(pipelines.final);
      finalPass.setBindGroup(1, t.finalBind);
      finalPass.draw(3);
      finalPass.end();

      device.queue.submit([encoder.finish()]);
      renderer.frameCount++;
      const elapsed = performance.now() - start;
      renderer.cpuMs = renderer.frameCount === 1 ? elapsed : renderer.cpuMs * 0.9 + elapsed * 0.1;
      if (renderer.frameCount === 6 && renderer.cpuMs > 34 && renderer.budget > 700000) {
        renderer.budget = Math.max(600000, renderer.budget * 0.62);
        renderer.width = 0;
      }
      return presentFrame(device, renderer, t);
  }

  const note = (message) => {
    if (renderer.errors.length < 8) renderer.errors.push(message);
    canvas.dataset.gpuError = renderer.errors.join(' | ').slice(0, 500);
  };
  device.lost.then((info) => {
    renderer.lost = true;
    note(String(info?.message || info?.reason || 'device lost'));
    if (onFatal) onFatal(new Error(canvas.dataset.gpuError || 'device lost'));
  });
  device.addEventListener('uncapturederror', (event) => {
    note(String(event.error?.message || event.error));
  });
  view.zMode = 'webgpu';
  return renderer;
}

async function buildPipelines(device, module, layouts, buffers, samples, format, depthOn, additive) {
  return makePipelines(device, module, layouts, buffers, samples, format, depthOn, additive);
}

function makePipelines(device, module, layouts, buffers, samples, format, depthOn, additive) {
  const pipe = (layout, vert, frag, targets, extra) =>
    device.createRenderPipeline({
      layout,
      vertex: { module, entryPoint: vert, buffers: extra.full ? [] : buffers },
      fragment: { module, entryPoint: frag, targets },
      primitive: { topology: 'triangle-list', cullMode: extra.cull || 'none' },
      depthStencil: extra.depth,
      multisample: { count: extra.samples || 1 },
    });
  const mrt = [{ format: 'rgba16float' }, { format: 'rgba16float' }];
  return {
    shadow: device.createRenderPipeline({
      layout: layouts.uniform,
      vertex: { module, entryPoint: 'shadowVS', buffers },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: depthOn('depth32float', true),
    }),
    caustic: pipe(layouts.waves, 'causticVS', 'causticFS', [{ format: 'rgba16float', blend: additive }], { cull: 'back' }),
    background: pipe(layouts.backdrop, 'fullVS', 'backgroundFS', mrt, { full: true, samples, depth: depthOn('depth24plus', false, 'always') }),
    mesh: pipe(layouts.mesh, 'meshVS', 'meshFS', mrt, { samples, depth: depthOn('depth24plus', true), cull: 'back' }),
    back: pipe(layouts.waves, 'waterVS', 'backFS', [{ format: 'rgba16float' }], { depth: depthOn('depth24plus', true), cull: 'front' }),
    copy: pipe(layouts.copy, 'fullVS', 'copyFS', [{ format: 'rgba16float' }], { full: true, samples, depth: depthOn('depth24plus', false, 'always') }),
    water: pipe(layouts.water, 'waterVS', 'waterFS', [{ format: 'rgba16float' }], { samples, depth: depthOn('depth24plus', false), cull: 'back' }),
    final: pipe(layouts.final, 'fullVS', 'finalFS', [{ format }], { full: true }),
  };
}

function gpuMesh(device, mesh, kind) {
  const vb = buffer(device, mesh.vertices, GPUBufferUsage.VERTEX);
  const ib = buffer(device, mesh.indices, GPUBufferUsage.INDEX);
  const instance = buffer(device, new Float32Array([0, 0, 0, 1, kind ?? 0, 0, 0, 0]), GPUBufferUsage.VERTEX);
  return { vb, ib, count: mesh.indices.length, instance };
}

function buffer(device, data, usage) {
  const src = data instanceof Uint32Array || data instanceof Float32Array ? data : new Float32Array(data);
  const buf = device.createBuffer({ size: Math.max(4, (src.byteLength + 3) & ~3), usage, mappedAtCreation: true });
  new Uint8Array(buf.getMappedRange()).set(new Uint8Array(src.buffer, src.byteOffset, src.byteLength));
  buf.unmap();
  return buf;
}

function ensureTargets(device, renderer, samples) {
  const buf = drawingBuffer(renderer.canvas, renderer.budget);
  if (renderer.targets && buf.w === renderer.width && buf.h === renderer.height) return;
  renderer.width = buf.w;
  renderer.height = buf.h;
  renderer.dpr = buf.dpr;
  if (renderer.canvas.width !== buf.w) renderer.canvas.width = buf.w;
  if (renderer.canvas.height !== buf.h) renderer.canvas.height = buf.h;
  if (renderer.targets) {
    if (renderer.targets.readBuf) renderer.targets.readBuf.destroy();
    for (const tex of renderer.targets.owned) tex.destroy();
  }
  const w = buf.w;
  const h = buf.h;
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
  const color = device.createTexture({ size: [w, h], format: 'rgba16float', usage, sampleCount: 1 });
  const distance = device.createTexture({ size: [w, h], format: 'rgba16float', usage, sampleCount: 1 });
  const sceneTex = device.createTexture({ size: [w, h], format: 'rgba16float', usage, sampleCount: 1 });
  const back = device.createTexture({ size: [w, h], format: 'rgba16float', usage, sampleCount: 1 });
  const depth = device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT, sampleCount: samples });
  const backDepth = device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT, sampleCount: 1 });
  let colorMS = color;
  let distMS = distance;
  let sceneMS = sceneTex;
  const owned = [color, distance, sceneTex, back, depth, backDepth];
  if (samples > 1) {
    colorMS = device.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT, sampleCount: samples });
    distMS = device.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT, sampleCount: samples });
    sceneMS = device.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT, sampleCount: samples });
    owned.push(colorMS, distMS, sceneMS);
  }
  renderer.targets = {
    owned,
    colorView: colorMS.createView(),
    colorResolve: samples > 1 ? color.createView() : null,
    distView: distMS.createView(),
    distResolve: samples > 1 ? distance.createView() : null,
    sceneView: sceneMS.createView(),
    sceneResolve: samples > 1 ? sceneTex.createView() : null,
    sceneTex,
    sceneSample: sceneTex.createView(),
    backView: back.createView(),
    backSample: back.createView(),
    depthView: depth.createView(),
    backDepthView: backDepth.createView(),
    opaque: color,
    opaqueView: color.createView(),
    distance,
    distanceView: distance.createView(),
    present: null,
    presentView: null,
    readBuf: null,
  };
  if (renderer.readback) {
    const present = device.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    owned.push(present);
    renderer.targets.present = present;
    renderer.targets.presentView = present.createView();
  }
}

function presentFrame(device, renderer, t) {
  if (!renderer.readback) {
    renderer.canvas.dataset.presented = String(renderer.frameCount);
    return Promise.resolve();
  }
  const w = renderer.width;
  const h = renderer.height;
  const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
  const size = bytesPerRow * h;
  if (!t.readBuf || t.readBuf.size < size) {
    if (t.readBuf) t.readBuf.destroy();
    t.readBuf = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture: t.present }, { buffer: t.readBuf, bytesPerRow, rowsPerImage: h }, [w, h]);
  device.queue.submit([encoder.finish()]);
  const buf = t.readBuf;
  return buf.mapAsync(GPUMapMode.READ).then(() => {
    const src = new Uint8Array(buf.getMappedRange());
    const count = w * h * 4;
    if (!renderer.pixels || renderer.pixels.length !== count) renderer.pixels = new Uint8ClampedArray(count);
    const tight = renderer.pixels;
    for (let y = 0; y < h; y++) tight.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4);
    buf.unmap();
    renderer.ctx2d.putImageData(new ImageData(tight, w, h), 0, 0);
    renderer.canvas.dataset.presented = String(renderer.frameCount);
  });
}

function attach(view, resolve, clear, store = 'discard') {
  if (resolve) return { view, resolveTarget: resolve, clearValue: clear, loadOp: 'clear', storeOp: 'discard' };
  return { view, clearValue: clear, loadOp: 'clear', storeOp: store === 'store' ? 'store' : 'store' };
}

function uploadWaves(device, texture, packed, gn, rowBytes, padded, pad) {
  if (!pad) {
    device.queue.writeTexture({ texture }, packed, { bytesPerRow: rowBytes, rowsPerImage: gn }, [gn, gn]);
    return;
  }
  const src = new Uint8Array(packed.buffer, packed.byteOffset, packed.byteLength);
  for (let j = 0; j < gn; j++) pad.set(src.subarray(j * rowBytes, j * rowBytes + rowBytes), j * padded);
  device.queue.writeTexture({ texture }, pad, { bytesPerRow: padded, rowsPerImage: gn }, [gn, gn]);
}

function drawStatic(pass, meshes, names) {
  for (const name of names) drawMesh(pass, meshes[name], meshes[name].instance, 1);
}

function drawSphere(pass, mesh, instance, count) {
  if (!count) return;
  drawMesh(pass, mesh, instance, count);
}

function drawMesh(pass, mesh, instance, count) {
  pass.setVertexBuffer(0, mesh.vb);
  if (instance) pass.setVertexBuffer(1, instance);
  pass.setIndexBuffer(mesh.ib, 'uint32');
  pass.drawIndexed(mesh.count, count);
}
