export const WGSL = /* wgsl */ `
struct Globals {
  vp: mat4x4f, ivp: mat4x4f, model: mat4x4f, invModel: mat4x4f, sunVP: mat4x4f,
  eye: vec4f, viewport: vec4f, sunDir: vec4f, water: vec4f, wobble: vec4f,
  absorption: vec4f, tint: vec4f, sand: vec4f,
  soil0: vec4f, soil1: vec4f, soil2: vec4f, soil3: vec4f, soil4: vec4f,
  leaf: vec4f, trunk: vec4f, coconut: vec4f, pebble: vec4f,
  palm0: vec4f, palm1: vec4f, palm2: vec4f, grid: vec4f,
};
@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var waves: texture_2d<f32>;
@group(0) @binding(2) var shadowMap: texture_depth_2d;
@group(0) @binding(3) var shadowSampler: sampler_comparison;
@group(0) @binding(4) var caustics: texture_2d<f32>;
@group(0) @binding(5) var linearSampler: sampler;
@group(0) @binding(6) var opaqueColor: texture_2d<f32>;
@group(0) @binding(7) var opaqueDistance: texture_2d<f32>;
@group(0) @binding(8) var backDistance: texture_2d<f32>;
@group(1) @binding(0) var finalScene: texture_2d<f32>;
@group(1) @binding(1) var finalSampler: sampler;

const HALF: f32 = 2.6;
const SIDE: f32 = 5.2;
const PI: f32 = 3.1415926536;

fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123); }
fn hash3(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453); }
fn noise2(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2f(1.0, 0.0)), u.x), mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0)), u.x), u.y);
}
fn gridN() -> f32 { return g.grid.x; }
fn gridY() -> f32 { return g.grid.y; }
fn waveSample(p: vec2f) -> vec4f {
  let q = clamp((p + vec2f(HALF)) / gridY() - 0.5, vec2f(0.0), vec2f(gridN() - 1.001));
  let i = vec2i(floor(q)); let f = fract(q);
  return mix(mix(textureLoad(waves, i, 0), textureLoad(waves, i + vec2i(1, 0), 0), f.x),
             mix(textureLoad(waves, i + vec2i(0, 1), 0), textureLoad(waves, i + vec2i(1, 1), 0), f.x), f.y);
}
fn palmOf(id: f32) -> vec4f { if (id < 0.5) { return g.palm0; } if (id < 1.5) { return g.palm1; } return g.palm2; }
fn wob(p: vec3f) -> vec3f {
  let sy = 1.0 - g.wobble.z; let lat = inverseSqrt(max(sy, 0.2));
  return vec3f(p.x * lat + g.wobble.x * p.y, p.y * sy, p.z * lat + g.wobble.y * p.y);
}
fn unwob(p: vec3f) -> vec3f {
  let sy = 1.0 - g.wobble.z; let lat = inverseSqrt(max(sy, 0.2)); let y = p.y / sy;
  return vec3f((p.x - g.wobble.x * y) / lat, y, (p.z - g.wobble.y * y) / lat);
}
fn deform(pIn: vec3f, extra: vec4f) -> vec3f {
  var p = pIn;
  if (extra.x >= 0.0) {
    let palm = palmOf(extra.x);
    p.x += palm.x * extra.y * extra.y; p.z += palm.y * extra.y * extra.y;
    let flutter = extra.z * 0.009 * (1.0 - g.wobble.w);
    p.y += sin(g.viewport.z * 3.2 + extra.w + p.x * 4.0) * flutter;
    p.x += cos(g.viewport.z * 2.6 + extra.w) * flutter * 0.4;
  }
  return wob(p);
}
fn model3(v: vec3f) -> vec3f {
  return mat3x3f(g.model[0].xyz, g.model[1].xyz, g.model[2].xyz) * v;
}
fn deformNormal(p: vec3f, nrm: vec3f, extra: vec4f) -> vec3f {
  let axis = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(nrm.y) > 0.85);
  let t = normalize(cross(nrm, axis)); let b = cross(nrm, t);
  let a = deform(p, extra);
  let dp = deform(p + t * 0.002, extra) - a; let db = deform(p + b * 0.002, extra) - a;
  return normalize(model3(normalize(cross(dp, db))));
}
fn shadowAt(p: vec3f, n: vec3f) -> f32 {
  let s = g.sunVP * vec4f(p, 1.0); let q = s.xyz / s.w;
  let uv = vec2f(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || q.z < 0.0 || q.z > 1.0) { return 1.0; }
  let bias = 0.0014 + 0.0022 * (1.0 - max(0.0, dot(n, normalize(g.sunDir.xyz))));
  let size = max(g.grid.z, 1.0); var light = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      light += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2f(f32(i), f32(j)) / size, q.z - bias);
    }
  }
  return light / 9.0;
}
fn causticAt(p: vec2f) -> f32 {
  let uv = clamp((p + vec2f(HALF)) / SIDE, vec2f(0.001), vec2f(0.999));
  return textureSampleLevel(caustics, linearSampler, uv, 0.0).r;
}
fn environment(r: vec3f) -> vec3f {
  let up = smoothstep(-0.1, 0.7, r.y);
  var c = mix(vec3f(0.51, 0.48, 0.42), vec3f(0.86, 0.92, 0.93), up);
  let a = pow(clamp(dot(r, normalize(vec3f(-0.7, 1.2, 0.4))), 0.0, 1.0), 54.0);
  let b = pow(clamp(dot(r, normalize(vec3f(0.8, 0.6, -0.7))), 0.0, 1.0), 100.0);
  let sx = (r.x + 0.26) / 0.095; let strip = exp(-sx * sx) * smoothstep(0.4, 0.8, r.y);
  c += vec3f(1.2, 1.15, 1.0) * a + vec3f(0.52, 0.64, 0.69) * b + vec3f(0.24) * strip;
  return c;
}
fn specLight(n: vec3f, v: vec3f, l: vec3f, rough: f32) -> f32 {
  let h = normalize(v + l); let nh = max(0.0, dot(n, h)); let a = rough * rough;
  let d = a * a / (PI * pow(nh * nh * (a * a - 1.0) + 1.0, 2.0) + 0.00001);
  return min(4.0, d * 0.045) * max(0.0, dot(n, l));
}
fn aabbRay(o: vec3f, d: vec3f, lo: vec3f, hi: vec3f) -> vec2f {
  let inv = 1.0 / select(vec3f(0.00001), d, abs(d) > vec3f(0.00001));
  let a = (lo - o) * inv; let b = (hi - o) * inv; let near = min(a, b); let far = max(a, b);
  return vec2f(max(max(near.x, near.y), near.z), min(min(far.x, far.y), far.z));
}
fn blockShadow(p: vec3f, light: vec3f) -> vec3f {
  let o = unwob((g.invModel * vec4f(p, 1.0)).xyz);
  let d = normalize((g.invModel * vec4f(light, 0.0)).xyz);
  let range = aabbRay(o, d, vec3f(-HALF, 0.0, -HALF), vec3f(HALF, g.water.x, HALF));
  if (range.y <= max(range.x, 0.0)) { return vec3f(1.0); }
  let entry = o + d * max(range.x, 0.0);
  let exit = o + d * range.y;
  if (entry.y < waveSample(entry.xz).w + 0.015) { return vec3f(0.39, 0.37, 0.33); }
  let len = max(0.0, range.y - max(range.x, 0.0));
  let trans = exp(-g.absorption.rgb * len * 0.78);
  let fleck = min(0.18, causticAt(mix(entry.xz, exit.xz, 0.5)) * 0.13);
  return min(vec3f(1.0), mix(vec3f(0.40, 0.43, 0.40), trans, 0.57) + vec3f(fleck));
}
fn soilOf(layer: i32) -> vec3f {
  if (layer == 1) { return g.soil1.rgb; } if (layer == 2) { return g.soil2.rgb; }
  if (layer == 3) { return g.soil3.rgb; } if (layer == 4) { return g.soil4.rgb; } return g.soil0.rgb;
}

struct Vary {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) local: vec3f,
  @location(3) uv: vec2f,
  @location(4) @interpolate(flat) param: vec4f,
  @location(5) object: vec3f,
};
struct VertexIn {
  @location(0) p: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,
  @location(3) extra: vec4f,
  @location(4) place: vec4f,
  @location(5) param: vec4f,
};
struct SceneOut {
  @location(0) color: vec4f,
  @location(1) distance: vec4f,
};

struct MeshRaw {
  pos: vec4f, world: vec3f, normal: vec3f, local: vec3f, uv: vec2f, param: vec4f, object: vec3f,
};
fn meshVertex(v: VertexIn, shadow: bool) -> MeshRaw {
  var p = v.p; var n = v.n;
  if (v.param.x >= 4.0) {
    let sy = 1.0 - v.param.y; let sx = inverseSqrt(max(sy, 0.25));
    p *= vec3f(sx, sy, sx); n = normalize(n / vec3f(sx, sy, sx));
  }
  p = p * v.place.w + v.place.xyz;
  let world = (g.model * vec4f(deform(p, v.extra), 1.0)).xyz;
  var o: MeshRaw;
  o.world = world; o.normal = deformNormal(p, n, v.extra); o.local = p; o.uv = v.uv;
  o.param = vec4f(v.param.xyz, v.place.w); o.object = v.p;
  if (shadow) { o.pos = g.sunVP * vec4f(world, 1.0); }
  else { o.pos = g.vp * vec4f(world, 1.0); }
  return o;
}
@vertex fn meshVS(v: VertexIn) -> Vary {
  let r = meshVertex(v, false);
  var o: Vary;
  o.pos = r.pos; o.world = r.world; o.normal = r.normal; o.local = r.local; o.uv = r.uv; o.param = r.param; o.object = r.object;
  return o;
}
@vertex fn shadowVS(v: VertexIn) -> @builtin(position) vec4f { return meshVertex(v, true).pos; }

@fragment fn meshFS(v: Vary, @builtin(front_facing) facing: bool) -> SceneOut {
  let kind = v.param.x;
  var n = normalize(select(-v.normal, v.normal, facing));
  let view = normalize(g.eye.xyz - v.world);
  let sun = normalize(g.sunDir.xyz);
  let shadow = shadowAt(v.world, n);
  let ndl = max(0.0, dot(n, sun));
  let hemi = 0.60 + 0.15 * n.y;
  var color = g.sand.rgb; var rough = 0.65; var coat = 0.0;
  let ground = waveSample(v.local.xz);
  let waterHeight = g.water.x + ground.x;
  if (kind < 0.5) {
    let grain = (hash3(floor(v.local * 1350.0)) - 0.5) * 0.07;
    let ripple = sin(v.local.x * 62.0 + sin(v.local.z * 12.0) * 2.0) * 0.013;
    color = g.sand.rgb * (1.0 + grain + ripple);
    let wet = 1.0 - smoothstep(waterHeight - 0.01, waterHeight + 0.08, v.local.y);
    color *= 1.0 - wet * 0.28;
    let depth = max(0.0, waterHeight - v.local.y);
    color += vec3f(0.45, 0.40, 0.25) * causticAt(v.local.xz) * exp(-depth * 1.8) * select(0.0, 1.0, depth > 0.004) * shadow;
    let rock = max(exp(-dot(v.local.xz - vec2f(-1.7, 1.35), v.local.xz - vec2f(-1.7, 1.35)) / 0.027),
                   exp(-dot(v.local.xz - vec2f(1.75, -1.2), v.local.xz - vec2f(1.75, -1.2)) / 0.029));
    color = mix(color, vec3f(0.29, 0.32, 0.26) * (1.0 + grain * 3.0), smoothstep(0.32, 0.7, rock));
  } else if (kind < 1.5) {
    let h = v.local.y + sin(v.local.x * 7.0 + v.local.z * 6.0) * 0.006 + sin(v.local.x * 19.0 - v.local.z * 16.0) * 0.003;
    var layer = 0;
    if (h > 0.145) { layer = 1; } if (h > 0.33) { layer = 2; } if (h > 0.385) { layer = 3; } if (h > 0.59) { layer = 4; }
    color = soilOf(layer);
    let side = select(v.local.z, v.local.x, abs(n.x) > 0.5);
    let cell = vec2f(side * 10.0, v.local.y * 15.0); let id = floor(cell); let local = fract(cell) - 0.5;
    let pebble = 1.0 - smoothstep(0.14, 0.20, length(local * vec2f(1.0, 1.4)));
    color = mix(color, color * 0.52, pebble * step(0.82, hash2(id)));
    color *= 0.94 + 0.10 * noise2(vec2f(side * 48.0, v.local.y * 45.0));
    rough = 0.34; coat = 0.05;
  } else if (kind < 2.5) {
    color = g.leaf.rgb * (0.88 + 0.16 * sin(v.uv.x * PI)); rough = 0.24; coat = 0.35;
    color += g.leaf.rgb * pow(max(0.0, dot(-n, sun)), 1.8) * 0.58;
  } else if (kind < 3.5) {
    color = g.trunk.rgb * (0.9 + 0.09 * sin(v.uv.y * PI * 46.0)); rough = 0.19; coat = 0.4;
  } else if (kind < 4.5) {
    let stripe = sin(v.uv.x * PI * 90.0 + sin(v.uv.y * 25.0) * 2.0);
    let fibers = noise2(v.uv * vec2f(180.0, 10.0));
    color = g.coconut.rgb * (0.85 + fibers * 0.34 + stripe * 0.05);
    color = mix(color, g.coconut.rgb * 2.0, smoothstep(0.72, 0.90, v.object.y) * 0.48);
    let eyes = pow(max(0.0, sin(v.uv.x * 3.0 * PI + v.param.z * 2.0)), 14.0) * smoothstep(0.55, 0.83, v.object.y) * (1.0 - smoothstep(0.85, 0.96, v.object.y));
    color *= 1.0 - eyes * 0.5; rough = 0.48; coat = 0.07;
  } else if (kind < 5.5) {
    let t = v.param.z;
    color = g.pebble.rgb * mix(vec3f(0.84, 0.87, 0.93), vec3f(1.12, 0.91, 0.86), t);
    color += vec3f(0.05, -0.012, 0.025) * sin(t * 34.0); rough = 0.24; coat = 0.15;
  } else {
    let localN = normalize(v.object);
    let incoming = normalize((g.invModel * vec4f(-view, 0.0)).xyz);
    var inside = refract(incoming, localN, 1.333);
    let tir = dot(inside, inside) < 0.0001;
    let radius = max(v.param.w, 0.001);
    let center = v.local - localN * radius;
    let exit = v.local + inside * max(0.0, -2.0 * dot(localN * radius, inside));
    let exitN = normalize(exit - center);
    var outgoing = refract(inside, -exitN, 1.0 / 1.333);
    if (dot(outgoing, outgoing) < 0.0001) { outgoing = vec3f(0.0, -1.0, 0.0); }
    var travel = max(0.0, (exit.y - waveSample(exit.xz).w) / max(0.08, -outgoing.y));
    for (var j = 0; j < 3; j++) { let hit = exit + outgoing * travel; travel = max(0.0, (exit.y - waveSample(hit.xz).w) / max(0.08, -outgoing.y)); }
    let hit = exit + outgoing * travel;
    let sandLight = g.sand.rgb * (0.74 + max(0.0, g.sunDir.y) * 0.52) + vec3f(0.24, 0.22, 0.13) * causticAt(hit.xz);
    let trans = exp(-g.absorption.rgb * min(travel, 4.0));
    let transmitted = sandLight * trans + g.tint.rgb * (vec3f(1.0) - trans) * 0.76;
    let fres = 0.025 + 0.975 * pow(1.0 - clamp(dot(n, view), 0.0, 1.0), 4.0);
    color = mix(transmitted, environment(reflect(-view, n)), select(fres, 0.88, tir));
    color += vec3f(0.35) * pow(clamp(dot(reflect(-sun, n), view), 0.0, 1.0), 85.0);
    var bubble: SceneOut;
    bubble.color = vec4f(max(color, vec3f(0.0)), 1.0);
    bubble.distance = vec4f(length(v.world - g.eye.xyz), 0.0, 0.0, 1.0);
    return bubble;
  }
  let diffuse = hemi + ndl * shadow * 0.66;
  let env = environment(reflect(-view, n));
  let fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(n, view), 0.0, 1.0), 5.0);
  color = color * diffuse + env * fres * coat + vec3f(1.0, 0.94, 0.79) * specLight(n, view, sun, rough) * shadow * select(0.14, 0.75, kind > 1.5);
  if (kind > 1.5 && kind < 3.5) { color += g.leaf.rgb * 0.10 * pow(max(0.0, 1.0 - abs(dot(n, view))), 2.0); }
  var o: SceneOut;
  o.color = vec4f(max(color, vec3f(0.0)), 1.0);
  o.distance = vec4f(length(v.world - g.eye.xyz), 0.0, 0.0, 1.0);
  return o;
}

struct Full { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn fullVS(@builtin(vertex_index) i: u32) -> Full {
  var o: Full;
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  o.pos = vec4f(p[i], 0.999999, 1.0);
  o.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
  return o;
}
@fragment fn backgroundFS(v: Full) -> SceneOut {
  var o: SceneOut;
  let clip = g.ivp * vec4f(v.uv.x * 2.0 - 1.0, 1.0 - v.uv.y * 2.0, 1.0, 1.0);
  let dir = normalize(clip.xyz / clip.w - g.eye.xyz);
  let t = (-0.016 - g.eye.y) / min(-0.00001, dir.y);
  let p = g.eye.xyz + dir * t;
  let vignette = dot(v.uv - vec2f(0.5), v.uv - vec2f(0.5));
  var color = vec3f(0.83, 0.803, 0.756) * (1.0 - vignette * 0.12);
  if (dir.y < -0.001 && t < 80.0) {
    let sun = normalize(g.sunDir.xyz); var shade = vec3f(0.0);
    for (var k = 0; k < 5; k++) { let a = f32(k) * 2.399; shade += blockShadow(p, normalize(sun + vec3f(cos(a) * 0.018, 0.0, sin(a) * 0.018))); }
    shade /= 5.0; color *= mix(vec3f(1.0), shade, 0.77);
    let q = (g.invModel * vec4f(p, 1.0)).xyz;
    let outside = length(max(abs(q.xz) - vec2f(HALF - 0.03), vec2f(0.0)));
    let ao = exp(-outside * 14.0) * exp(-max(0.0, -q.y) * 4.0);
    color *= 1.0 - ao * 0.13;
    color += vec3f((hash2(floor(v.pos.xy)) - 0.5) * 0.002);
    o.distance = vec4f(t, 0.0, 0.0, 1.0);
  } else { o.distance = vec4f(1000.0, 0.0, 0.0, 1.0); }
  o.color = vec4f(color, 1.0);
  return o;
}

@vertex fn waterVS(v: VertexIn) -> Vary {
  let wave = waveSample(v.p.xz);
  var p = v.p; var n = v.n;
  if (v.extra.x < 0.5) { p.y = g.water.x + wave.x; n = normalize(vec3f(-wave.y, 1.0, -wave.z)); }
  else { p.y = mix(wave.w - 0.004, g.water.x + wave.x, v.uv.y); }
  let world = (g.model * vec4f(wob(p), 1.0)).xyz;
  var o: Vary;
  o.world = world; o.normal = deformNormal(p, n, vec4f(-1.0, 0.0, 0.0, 0.0));
  o.local = p; o.uv = v.uv; o.param = vec4f(v.extra.x, 0.0, 0.0, 0.0); o.object = v.p;
  o.pos = g.vp * vec4f(world, 1.0);
  return o;
}
@fragment fn backFS(v: Vary) -> @location(0) vec4f {
  let w = waveSample(v.local.xz);
  if (w.w > g.water.x + w.x - 0.001) { discard; }
  return vec4f(length(v.world - g.eye.xyz), 0.0, 0.0, 1.0);
}
@fragment fn waterFS(v: Vary) -> @location(0) vec4f {
  let wave = waveSample(v.local.xz);
  if (wave.w > g.water.x + wave.x - 0.001) { discard; }
  let screen = v.pos.xy / g.viewport.xy;
  let frontDist = length(v.world - g.eye.xyz);
  let pixel = vec2i(clamp(v.pos.xy, vec2f(0.0), g.viewport.xy - vec2f(1.0)));
  let back = textureLoad(backDistance, pixel, 0).r;
  let sceneDist = textureLoad(opaqueDistance, pixel, 0).r;
  var path = max(0.008, min(sceneDist, back) - frontDist);
  if (back < sceneDist - 0.03) { path += 0.3; }
  path = min(path, 5.0);
  var n = normalize(v.normal);
  let view = normalize(g.eye.xyz - v.world);
  if (dot(n, view) < 0.0) { n = -n; }
  let projected = g.vp * vec4f(v.world + n * 0.065, 1.0);
  let offset = vec2f(projected.x / projected.w * 0.5 + 0.5, 0.5 - projected.y / projected.w * 0.5) - screen;
  var uv = clamp(screen + offset * (1.3 + min(1.0, path)), vec2f(0.001), vec2f(0.999));
  let q = vec2i(clamp(uv * g.viewport.xy, vec2f(0.0), g.viewport.xy - vec2f(1.0)));
  if (textureLoad(opaqueDistance, q, 0).r < frontDist - 0.02) { uv = screen; }
  let scene = textureSampleLevel(opaqueColor, linearSampler, uv, 0.0).rgb;
  let transmission = exp(-g.absorption.rgb * path);
  var color = scene * transmission + g.tint.rgb * (vec3f(1.0) - transmission) * 0.76;
  let fres = 0.026 + 0.974 * pow(1.0 - clamp(dot(n, view), 0.0, 1.0), 5.0);
  color = mix(color, environment(reflect(-view, n)), clamp(fres, 0.0, 0.92));
  let sun = normalize(g.sunDir.xyz);
  let shadow = shadowAt(v.world, n);
  color += vec3f(1.0, 0.96, 0.84) * specLight(n, view, sun, 0.135) * shadow * 0.60;
  var shafts = 0.0; let count = max(g.grid.w, 1.0);
  for (var j = 0; j < 6; j++) {
    if (f32(j) >= count) { break; }
    let t = (f32(j) + 0.5) / count * min(path, 1.5);
    shafts += causticAt(v.local.xz - view.xz * t * 0.7) * exp(-t * 3.0);
  }
  color += g.tint.rgb * shafts * (6.0 / count) * 0.010 * shadow;
  let edge = min(HALF - abs(v.local.x), HALF - abs(v.local.z));
  if (v.param.x < 0.5) {
    let rim = 1.0 - smoothstep(0.006, 0.023, edge);
    let meniscus = (1.0 - smoothstep(0.019, 0.055, edge)) * (1.0 - rim);
    color *= 1.0 - meniscus * 0.075;
    color += vec3f(0.52, 0.64, 0.59) * rim * 0.23;
    let shore = g.water.x + wave.x - wave.w;
    color += vec3f(0.18, 0.22, 0.15) * (1.0 - smoothstep(0.008, 0.043, shore)) * 0.15;
  } else {
    let top = g.water.x + wave.x - v.local.y;
    let rim = 1.0 - smoothstep(0.006, 0.021, top);
    let cornerDistance = select(HALF - abs(v.local.x), HALF - abs(v.local.z), abs(v.object.x) > HALF - 0.001);
    let corner = 1.0 - smoothstep(0.007, 0.024, cornerDistance);
    color += vec3f(0.50, 0.64, 0.60) * rim * 0.26;
    color += vec3f(0.2, 0.3, 0.27) * corner * 0.026;
  }
  return vec4f(max(color, vec3f(0.0)), 1.0);
}

struct CausticVary {
  @builtin(position) pos: vec4f,
  @location(0) original: vec2f,
  @location(1) hit: vec2f,
  @location(2) depth: f32,
};
@vertex fn causticVS(v: VertexIn) -> CausticVary {
  let wave = waveSample(v.p.xz);
  let p = vec3f(v.p.x, g.water.x + wave.x, v.p.z);
  let normal = normalize(vec3f(-wave.y, 1.0, -wave.z));
  let localSun = normalize((g.invModel * vec4f(g.sunDir.xyz, 0.0)).xyz);
  var ray = refract(-localSun, normal, 1.0 / 1.333);
  if (dot(ray, ray) < 1e-6) { ray = -normal; }
  var t = max(0.0, (p.y - wave.w) / max(0.1, -ray.y));
  for (var j = 0; j < 4; j++) { let hit = p + ray * t; t = max(0.0, (p.y - waveSample(hit.xz).w) / max(0.1, -ray.y)); }
  let hit = p + ray * t;
  var o: CausticVary;
  o.pos = vec4f(hit.x / HALF, -hit.z / HALF, 0.0, 1.0);
  o.original = p.xz; o.hit = hit.xz; o.depth = p.y - wave.w;
  return o;
}
@fragment fn causticFS(v: CausticVary) -> @location(0) vec4f {
  let a = dpdx(v.original); let b = dpdy(v.original); let c = dpdx(v.hit); let d = dpdy(v.hit);
  let source = abs(a.x * b.y - a.y * b.x);
  let area = max(0.00000001, abs(c.x * d.y - c.y * d.x));
  let focus = clamp(source / area, 0.0, 6.0);
  let wet = smoothstep(0.006, 0.045, v.depth);
  return vec4f(vec3f(focus * 0.36 * wet), 1.0);
}
@fragment fn copyFS(v: Full) -> @location(0) vec4f { return textureSampleLevel(opaqueColor, linearSampler, v.uv, 0.0); }
@fragment fn finalFS(v: Full) -> @location(0) vec4f {
  var c = max(vec3f(0.0), textureSampleLevel(finalScene, finalSampler, v.uv, 0.0).rgb);
  let shoulder = vec3f(0.8) + (c - vec3f(0.8)) / (vec3f(1.0) + (c - vec3f(0.8)) / 0.42);
  c = select(c, shoulder, c > vec3f(0.8));
  let lo = c * 12.92; let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  c = select(lo, hi, c > vec3f(0.0031308));
  c += (hash2(v.pos.xy) - 0.5) / 255.0;
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;
