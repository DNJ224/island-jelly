const UBO = `
layout(std140) uniform Globals {
  mat4 vp; mat4 ivp; mat4 model; mat4 invModel; mat4 sunVP;
  vec4 eye; vec4 viewport; vec4 sunDir; vec4 water; vec4 wobble;
  vec4 absorption; vec4 tint; vec4 sand;
  vec4 soil0; vec4 soil1; vec4 soil2; vec4 soil3; vec4 soil4;
  vec4 leaf; vec4 trunk; vec4 coconut; vec4 pebble;
  vec4 palm0; vec4 palm1; vec4 palm2; vec4 grid;
} g;
const float HALF = 2.6;
const float SIDE = 5.2;
const float PI = 3.1415926536;
uniform sampler2D waves;
uniform sampler2D shadowMap;
uniform sampler2D caustics;
uniform sampler2D opaqueColor;
uniform sampler2D opaqueDistance;
uniform sampler2D backDistance;
`;

const LIB = `
float hash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise2(vec2 p){vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash2(i),hash2(i+vec2(1.0,0.0)),u.x),mix(hash2(i+vec2(0.0,1.0)),hash2(i+vec2(1.0)),u.x),u.y);}
float gridN(){return g.grid.x;}
float gridY(){return g.grid.y;}
vec4 waveSample(vec2 p){
  vec2 q=clamp((p+vec2(HALF))/gridY()-0.5, vec2(0.0), vec2(gridN()-1.001));
  ivec2 i=ivec2(floor(q)); vec2 f=fract(q);
  return mix(mix(texelFetch(waves,i,0),texelFetch(waves,i+ivec2(1,0),0),f.x),
             mix(texelFetch(waves,i+ivec2(0,1),0),texelFetch(waves,i+ivec2(1,1),0),f.x),f.y);
}
vec4 palmOf(float id){ if(id<0.5) return g.palm0; if(id<1.5) return g.palm1; return g.palm2; }
vec3 wob(vec3 p){ float sy=1.0-g.wobble.z; float lat=inversesqrt(max(sy,0.2));
  return vec3(p.x*lat+g.wobble.x*p.y, p.y*sy, p.z*lat+g.wobble.y*p.y); }
vec3 unwob(vec3 p){ float sy=1.0-g.wobble.z; float lat=inversesqrt(max(sy,0.2)); float y=p.y/sy;
  return vec3((p.x-g.wobble.x*y)/lat, y, (p.z-g.wobble.y*y)/lat); }
vec3 deform(vec3 p, vec4 extra){
  if(extra.x>=0.0){
    vec4 palm=palmOf(extra.x);
    p.x+=palm.x*extra.y*extra.y; p.z+=palm.y*extra.y*extra.y;
    float flutter=extra.z*0.009*(1.0-g.wobble.w);
    p.y+=sin(g.viewport.z*3.2+extra.w+p.x*4.0)*flutter;
    p.x+=cos(g.viewport.z*2.6+extra.w)*flutter*0.4;
  }
  return wob(p);
}
vec3 deformNormal(vec3 p, vec3 nrm, vec4 extra){
  vec3 axis=abs(nrm.y)>0.85?vec3(1.0,0.0,0.0):vec3(0.0,1.0,0.0);
  vec3 t=normalize(cross(nrm,axis)); vec3 b=cross(nrm,t);
  vec3 a=deform(p,extra);
  vec3 dp=deform(p+t*0.002,extra)-a; vec3 db=deform(p+b*0.002,extra)-a;
  return normalize(mat3(g.model)*normalize(cross(dp,db)));
}
float shadowAt(vec3 p, vec3 n){
  vec4 s=g.sunVP*vec4(p,1.0); vec3 q=s.xyz/s.w;
  float windowZ=q.z*0.5+0.5;
  vec2 uv=vec2(q.x*0.5+0.5, q.y*0.5+0.5);
  if(uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0||windowZ<0.0||windowZ>1.0) return 1.0;
  float bias=0.0014+0.0022*(1.0-max(0.0,dot(n,normalize(g.sunDir.xyz))));
  float size=max(g.grid.z,1.0); float light=0.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    float d=textureLod(shadowMap, uv+vec2(float(i),float(j))/size, 0.0).r;
    light += (windowZ-bias<=d) ? 1.0 : 0.0;
  }
  return light/9.0;
}
float causticAt(vec2 p){ vec2 uv=clamp((p+vec2(HALF))/SIDE, vec2(0.001), vec2(0.999)); return textureLod(caustics,uv,0.0).r; }
vec3 environment(vec3 r){
  float up=smoothstep(-0.1,0.7,r.y);
  vec3 c=mix(vec3(0.51,0.48,0.42), vec3(0.86,0.92,0.93), up);
  float a=pow(clamp(dot(r,normalize(vec3(-0.7,1.2,0.4))),0.0,1.0),54.0);
  float b=pow(clamp(dot(r,normalize(vec3(0.8,0.6,-0.7))),0.0,1.0),100.0);
  float sx=(r.x+0.26)/0.095; float strip=exp(-sx*sx)*smoothstep(0.4,0.8,r.y);
  c+=vec3(1.2,1.15,1.0)*a+vec3(0.52,0.64,0.69)*b+vec3(0.24)*strip;
  return c;
}
float specLight(vec3 n, vec3 v, vec3 l, float rough){
  vec3 h=normalize(v+l); float nh=max(0.0,dot(n,h)); float a=rough*rough;
  float d=a*a/(PI*pow(nh*nh*(a*a-1.0)+1.0,2.0)+0.00001);
  return min(4.0,d*0.045)*max(0.0,dot(n,l));
}
vec2 aabbRay(vec3 o, vec3 d, vec3 lo, vec3 hi){
  vec3 inv=1.0/vec3(abs(d.x)>0.00001?d.x:0.00001, abs(d.y)>0.00001?d.y:0.00001, abs(d.z)>0.00001?d.z:0.00001);
  vec3 a=(lo-o)*inv; vec3 b=(hi-o)*inv; vec3 near=min(a,b); vec3 far=max(a,b);
  return vec2(max(max(near.x,near.y),near.z), min(min(far.x,far.y),far.z));
}
vec3 blockShadow(vec3 p, vec3 light){
  vec3 o=unwob((g.invModel*vec4(p,1.0)).xyz);
  vec3 d=normalize((g.invModel*vec4(light,0.0)).xyz);
  vec2 range=aabbRay(o,d,vec3(-HALF,0.0,-HALF),vec3(HALF,g.water.x,HALF));
  if(range.y<=max(range.x,0.0)) return vec3(1.0);
  vec3 entry=o+d*max(range.x,0.0);
  vec3 exit=o+d*range.y;
  if(entry.y<waveSample(entry.xz).w+0.015) return vec3(0.39,0.37,0.33);
  float len=max(0.0,range.y-max(range.x,0.0));
  vec3 trans=exp(-g.absorption.rgb*len*0.78);
  float fleck=min(0.18, causticAt(mix(entry.xz,exit.xz,0.5))*0.13);
  return min(vec3(1.0), mix(vec3(0.40,0.43,0.40), trans, 0.57)+vec3(fleck));
}
float readDist(vec4 c){
#if FLOAT_RT
  return c.r;
#else
  return (c.r + c.g/255.0)*80.0;
#endif
}
vec4 writeDist(float d){
#if FLOAT_RT
  return vec4(d,0.0,0.0,1.0);
#else
  float x=clamp(d/80.0,0.0,1.0); float hi=floor(x*255.0)/255.0; float lo=clamp((x-hi)*255.0,0.0,1.0);
  return vec4(hi,lo,0.0,1.0);
#endif
}
vec3 soilOf(int layer){
  if(layer==1) return g.soil1.rgb; if(layer==2) return g.soil2.rgb;
  if(layer==3) return g.soil3.rgb; if(layer==4) return g.soil4.rgb; return g.soil0.rgb;
}
`;

const VARY = `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
layout(location=3) in vec4 aExtra;
layout(location=4) in vec4 aPlace;
layout(location=5) in vec4 aParam;
out vec3 vWorld; out vec3 vNormal; out vec3 vLocal; out vec2 vUv; flat out vec4 vParam; out vec3 vObject;
`;

const VARY_IN = `
in vec3 vWorld; in vec3 vNormal; in vec3 vLocal; in vec2 vUv; flat in vec4 vParam; in vec3 vObject;
`;

function meshVS(shadow) {
  return `${VARY}
void main(){
  vec3 p=aPos; vec3 n=aNrm;
  if(aParam.x>=4.0){
    float sy=1.0-aParam.y; float sx=inversesqrt(max(sy,0.25));
    p*=vec3(sx,sy,sx); n=normalize(n/vec3(sx,sy,sx));
  }
  p=p*aPlace.w+aPlace.xyz;
  vec3 world=(g.model*vec4(deform(p,aExtra),1.0)).xyz;
  vWorld=world; vNormal=deformNormal(p,n,aExtra); vLocal=p; vUv=aUv;
  vParam=aParam; vParam.w=aPlace.w; vObject=aPos;
  gl_Position=${shadow ? 'g.sunVP' : 'g.vp'}*vec4(world,1.0);
}`;
}

const MESH_FS = `${VARY_IN}
layout(location=0) out vec4 outColor;
layout(location=1) out vec4 outDist;
void emit(vec3 c, float d){
#if FLOAT_RT
  outColor=vec4(max(c,vec3(0.0)),1.0);
#else
  outColor=vec4(clamp(c,0.0,1.0),1.0);
#endif
  outDist=writeDist(d);
}
void main(){
  float kind=vParam.x;
  vec3 n=normalize(gl_FrontFacing?vNormal:-vNormal);
  vec3 view=normalize(g.eye.xyz-vWorld);
  vec3 sun=normalize(g.sunDir.xyz);
  float shadow=shadowAt(vWorld,n);
  float ndl=max(0.0,dot(n,sun));
  float hemi=0.60+0.15*n.y;
  vec3 color=g.sand.rgb; float rough=0.65; float coat=0.0;
  vec4 ground=waveSample(vLocal.xz);
  float waterHeight=g.water.x+ground.x;
  if(kind<0.5){
    float grain=(hash3(floor(vLocal*1350.0))-0.5)*0.07;
    float ripple=sin(vLocal.x*62.0+sin(vLocal.z*12.0)*2.0)*0.013;
    color=g.sand.rgb*(1.0+grain+ripple);
    float wet=1.0-smoothstep(waterHeight-0.01,waterHeight+0.08,vLocal.y);
    color*=1.0-wet*0.28;
    float depth=max(0.0,waterHeight-vLocal.y);
    color+=vec3(0.45,0.40,0.25)*causticAt(vLocal.xz)*exp(-depth*1.8)*(depth>0.004?1.0:0.0)*shadow;
    float rock=max(exp(-dot(vLocal.xz-vec2(-1.7,1.35),vLocal.xz-vec2(-1.7,1.35))/0.027),
                   exp(-dot(vLocal.xz-vec2(1.75,-1.2),vLocal.xz-vec2(1.75,-1.2))/0.029));
    color=mix(color, vec3(0.29,0.32,0.26)*(1.0+grain*3.0), smoothstep(0.32,0.7,rock));
  } else if(kind<1.5){
    float h=vLocal.y+sin(vLocal.x*7.0+vLocal.z*6.0)*0.006+sin(vLocal.x*19.0-vLocal.z*16.0)*0.003;
    int layer=0; if(h>0.145) layer=1; if(h>0.33) layer=2; if(h>0.385) layer=3; if(h>0.59) layer=4;
    color=soilOf(layer);
    float side=abs(n.x)>0.5?vLocal.x:vLocal.z;
    vec2 cell=vec2(side*10.0,vLocal.y*15.0); vec2 id=floor(cell); vec2 local=fract(cell)-0.5;
    float pebble=1.0-smoothstep(0.14,0.20,length(local*vec2(1.0,1.4)));
    color=mix(color,color*0.52,pebble*step(0.82,hash2(id)));
    color*=0.94+0.10*noise2(vec2(side*48.0,vLocal.y*45.0));
    rough=0.34; coat=0.05;
  } else if(kind<2.5){
    color=g.leaf.rgb*(0.88+0.16*sin(vUv.x*PI)); rough=0.24; coat=0.35;
    color+=g.leaf.rgb*pow(max(0.0,dot(-n,sun)),1.8)*0.58;
  } else if(kind<3.5){
    color=g.trunk.rgb*(0.9+0.09*sin(vUv.y*PI*46.0)); rough=0.19; coat=0.4;
  } else if(kind<4.5){
    float stripe=sin(vUv.x*PI*90.0+sin(vUv.y*25.0)*2.0);
    float fibers=noise2(vUv*vec2(180.0,10.0));
    color=g.coconut.rgb*(0.85+fibers*0.34+stripe*0.05);
    color=mix(color,g.coconut.rgb*2.0,smoothstep(0.72,0.90,vObject.y)*0.48);
    float eyes=pow(max(0.0,sin(vUv.x*3.0*PI+vParam.z*2.0)),14.0)*smoothstep(0.55,0.83,vObject.y)*(1.0-smoothstep(0.85,0.96,vObject.y));
    color*=1.0-eyes*0.5; rough=0.48; coat=0.07;
  } else if(kind<5.5){
    float t=vParam.z;
    color=g.pebble.rgb*mix(vec3(0.84,0.87,0.93),vec3(1.12,0.91,0.86),t);
    color+=vec3(0.05,-0.012,0.025)*sin(t*34.0); rough=0.24; coat=0.15;
  } else {
    vec3 localN=normalize(vObject);
    vec3 incoming=normalize((g.invModel*vec4(-view,0.0)).xyz);
    vec3 inside=refract(incoming, localN, 1.333);
    bool tir=dot(inside,inside)<0.0001;
    float radius=max(vParam.w,0.001);
    vec3 center=vLocal-localN*radius;
    vec3 exit=vLocal+inside*max(0.0,-2.0*dot(localN*radius,inside));
    vec3 exitN=normalize(exit-center);
    vec3 outgoing=refract(inside,-exitN,1.0/1.333);
    if(dot(outgoing,outgoing)<0.0001) outgoing=vec3(0.0,-1.0,0.0);
    float travel=max(0.0,(exit.y-waveSample(exit.xz).w)/max(0.08,-outgoing.y));
    for(int j=0;j<3;j++){ vec3 hit=exit+outgoing*travel; travel=max(0.0,(exit.y-waveSample(hit.xz).w)/max(0.08,-outgoing.y)); }
    vec3 hit=exit+outgoing*travel;
    vec3 sandLight=g.sand.rgb*(0.74+max(0.0,g.sunDir.y)*0.52)+vec3(0.24,0.22,0.13)*causticAt(hit.xz);
    vec3 trans=exp(-g.absorption.rgb*min(travel,4.0));
    vec3 transmitted=sandLight*trans+g.tint.rgb*(vec3(1.0)-trans)*0.76;
    float fres=0.025+0.975*pow(1.0-clamp(dot(n,view),0.0,1.0),4.0);
    color=mix(transmitted, environment(reflect(-view,n)), tir?0.88:fres);
    color+=vec3(0.35)*pow(clamp(dot(reflect(-sun,n),view),0.0,1.0),85.0);
    emit(color, length(vWorld-g.eye.xyz));
    return;
  }
  float diffuse=hemi+ndl*shadow*0.66;
  vec3 env=environment(reflect(-view,n));
  float fres=0.04+0.96*pow(1.0-clamp(dot(n,view),0.0,1.0),5.0);
  color=color*diffuse+env*fres*coat+vec3(1.0,0.94,0.79)*specLight(n,view,sun,rough)*shadow*(kind>1.5?0.75:0.14);
  if(kind>1.5 && kind<3.5) color+=g.leaf.rgb*0.10*pow(max(0.0,1.0-abs(dot(n,view))),2.0);
  emit(color, length(vWorld-g.eye.xyz));
}`;

const FULL_VS = `
out vec2 vUv;
void main(){
  vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2));
  vUv=vec2(p.x*0.5, p.y*0.5);
  gl_Position=vec4(p*2.0-1.0, 0.999999, 1.0);
}`;

const BACKGROUND_FS = `
in vec2 vUv;
layout(location=0) out vec4 outColor;
layout(location=1) out vec4 outDist;
void main(){
  vec2 ndc=vec2(gl_FragCoord.x/g.viewport.x*2.0-1.0, gl_FragCoord.y/g.viewport.y*2.0-1.0);
  vec4 clip=g.ivp*vec4(ndc,1.0,1.0);
  vec3 dir=normalize(clip.xyz/clip.w-g.eye.xyz);
  float t=(-0.016-g.eye.y)/min(-0.00001, dir.y);
  vec3 p=g.eye.xyz+dir*t;
  float vignette=dot(vUv-0.5, vUv-0.5);
  vec3 color=vec3(0.83,0.803,0.756)*(1.0-vignette*0.12);
  float dist=1000.0;
  if(dir.y<-0.001 && t<80.0){
    vec3 sun=normalize(g.sunDir.xyz); vec3 shade=vec3(0.0);
    for(int k=0;k<5;k++){ float a=float(k)*2.399; shade+=blockShadow(p, normalize(sun+vec3(cos(a)*0.018,0.0,sin(a)*0.018))); }
    shade/=5.0; color*=mix(vec3(1.0), shade, 0.77);
    vec3 q=(g.invModel*vec4(p,1.0)).xyz;
    float outside=length(max(abs(q.xz)-vec2(HALF-0.03), vec2(0.0)));
    float ao=exp(-outside*14.0)*exp(-max(0.0,-q.y)*4.0);
    color*=1.0-ao*0.13;
    color+=vec3((hash2(floor(gl_FragCoord.xy))-0.5)*0.002);
    dist=t;
  }
#if FLOAT_RT
  outColor=vec4(color,1.0);
#else
  outColor=vec4(clamp(color,0.0,1.0),1.0);
#endif
  outDist=writeDist(dist);
}`;

const WATER_VS = `${VARY}
void main(){
  vec4 wave=waveSample(aPos.xz);
  vec3 p=aPos; vec3 n=aNrm;
  if(aExtra.x<0.5){ p.y=g.water.x+wave.x; n=normalize(vec3(-wave.y,1.0,-wave.z)); }
  else { p.y=mix(wave.w-0.004, g.water.x+wave.x, aUv.y); }
  vec3 world=(g.model*vec4(wob(p),1.0)).xyz;
  vWorld=world; vNormal=deformNormal(p,n,vec4(-1.0,0.0,0.0,0.0));
  vLocal=p; vUv=aUv; vParam=vec4(aExtra.x,0.0,0.0,0.0); vObject=aPos;
  gl_Position=g.vp*vec4(world,1.0);
}`;

const BACK_FS = `${VARY_IN}
layout(location=0) out vec4 outDist;
void main(){
  vec4 w=waveSample(vLocal.xz);
  if(w.w>g.water.x+w.x-0.001) discard;
  outDist=writeDist(length(vWorld-g.eye.xyz));
}`;

const WATER_FS = `${VARY_IN}
layout(location=0) out vec4 outColor;
void main(){
  vec4 wave=waveSample(vLocal.xz);
  if(wave.w>g.water.x+wave.x-0.001) discard;
  vec2 screen=gl_FragCoord.xy/g.viewport.xy;
  float frontDist=length(vWorld-g.eye.xyz);
  ivec2 pixel=ivec2(clamp(gl_FragCoord.xy, vec2(0.0), g.viewport.xy-1.0));
  float back=readDist(texelFetch(backDistance, pixel, 0));
  float sceneDist=readDist(texelFetch(opaqueDistance, pixel, 0));
  float path=max(0.008, min(sceneDist, back)-frontDist);
  if(back<sceneDist-0.03) path+=0.3;
  path=min(path,5.0);
  vec3 n=normalize(vNormal);
  vec3 view=normalize(g.eye.xyz-vWorld);
  if(dot(n,view)<0.0) n=-n;
  vec4 projected=g.vp*vec4(vWorld+n*0.065,1.0);
  vec2 puv=vec2(projected.x/projected.w*0.5+0.5, projected.y/projected.w*0.5+0.5);
  vec2 uv=clamp(screen+(puv-screen)*(1.3+min(1.0,path)), vec2(0.001), vec2(0.999));
  ivec2 q=ivec2(clamp(uv*g.viewport.xy, vec2(0.0), g.viewport.xy-1.0));
  if(readDist(texelFetch(opaqueDistance, q, 0))<frontDist-0.02) uv=screen;
  vec3 scene=textureLod(opaqueColor, uv, 0.0).rgb;
  vec3 transmission=exp(-g.absorption.rgb*path);
  vec3 color=scene*transmission+g.tint.rgb*(vec3(1.0)-transmission)*0.76;
  float fres=0.026+0.974*pow(1.0-clamp(dot(n,view),0.0,1.0),5.0);
  color=mix(color, environment(reflect(-view,n)), clamp(fres,0.0,0.92));
  vec3 sun=normalize(g.sunDir.xyz);
  float shadow=shadowAt(vWorld,n);
  color+=vec3(1.0,0.96,0.84)*specLight(n,view,sun,0.135)*shadow*0.60;
  float shafts=0.0; float count=max(g.grid.w,1.0);
  for(int j=0;j<6;j++){
    if(float(j)>=count) break;
    float t=(float(j)+0.5)/count*min(path,1.5);
    shafts+=causticAt(vLocal.xz-view.xz*t*0.7)*exp(-t*3.0);
  }
  color+=g.tint.rgb*shafts*(6.0/count)*0.010*shadow;
  float edge=min(HALF-abs(vLocal.x), HALF-abs(vLocal.z));
  if(vParam.x<0.5){
    float rim=1.0-smoothstep(0.006,0.023,edge);
    float meniscus=(1.0-smoothstep(0.019,0.055,edge))*(1.0-rim);
    color*=1.0-meniscus*0.075;
    color+=vec3(0.52,0.64,0.59)*rim*0.23;
    float shore=g.water.x+wave.x-wave.w;
    color+=vec3(0.18,0.22,0.15)*(1.0-smoothstep(0.008,0.043,shore))*0.15;
  } else {
    float top=g.water.x+wave.x-vLocal.y;
    float rim=1.0-smoothstep(0.006,0.021,top);
    float cornerDistance=abs(vObject.x)>HALF-0.001 ? HALF-abs(vLocal.z) : HALF-abs(vLocal.x);
    float corner=1.0-smoothstep(0.007,0.024,cornerDistance);
    color+=vec3(0.50,0.64,0.60)*rim*0.26;
    color+=vec3(0.2,0.3,0.27)*corner*0.026;
  }
#if FLOAT_RT
  outColor=vec4(max(color,vec3(0.0)),1.0);
#else
  outColor=vec4(clamp(color,0.0,1.0),1.0);
#endif
}`;

const CAUSTIC_VS = `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
layout(location=3) in vec4 aExtra;
layout(location=4) in vec4 aPlace;
layout(location=5) in vec4 aParam;
out vec2 vOriginal; out vec2 vHit; out float vDepth;
void main(){
  vec4 wave=waveSample(aPos.xz);
  vec3 p=vec3(aPos.x, g.water.x+wave.x, aPos.z);
  vec3 normal=normalize(vec3(-wave.y,1.0,-wave.z));
  vec3 localSun=normalize((g.invModel*vec4(g.sunDir.xyz,0.0)).xyz);
  vec3 ray=refract(-localSun, normal, 1.0/1.333);
  if(dot(ray,ray)<1e-6) ray=-normal;
  float t=max(0.0,(p.y-wave.w)/max(0.1,-ray.y));
  for(int j=0;j<4;j++){ vec3 hit=p+ray*t; t=max(0.0,(p.y-waveSample(hit.xz).w)/max(0.1,-ray.y)); }
  vec3 hit=p+ray*t;
  gl_Position=vec4(hit.x/HALF, hit.z/HALF, 0.0, 1.0);
  vOriginal=p.xz; vHit=hit.xz; vDepth=p.y-wave.w;
}`;

const CAUSTIC_FS = `
in vec2 vOriginal; in vec2 vHit; in float vDepth;
layout(location=0) out vec4 outColor;
void main(){
  vec2 a=dFdx(vOriginal); vec2 b=dFdy(vOriginal); vec2 c=dFdx(vHit); vec2 d=dFdy(vHit);
  float source=abs(a.x*b.y-a.y*b.x);
  float area=max(0.00000001, abs(c.x*d.y-c.y*d.x));
  float focus=clamp(source/area, 0.0, 6.0);
  float wet=smoothstep(0.006,0.045,vDepth);
  outColor=vec4(vec3(focus*0.36*wet),1.0);
}`;

const COPY_FS = `
in vec2 vUv;
layout(location=0) out vec4 outColor;
void main(){ outColor=textureLod(opaqueColor, vUv, 0.0); }`;

const FINAL_FS = `
in vec2 vUv;
layout(location=0) out vec4 outColor;
void main(){
  vec3 c=max(vec3(0.0), textureLod(opaqueColor, vUv, 0.0).rgb);
  vec3 shoulder=vec3(0.8)+(c-vec3(0.8))/(vec3(1.0)+(c-vec3(0.8))/0.42);
  c=mix(c, shoulder, step(vec3(0.8), c));
  vec3 lo=c*12.92; vec3 hi=1.055*pow(max(c,vec3(0.0)), vec3(1.0/2.4))-0.055;
  c=mix(lo, hi, step(vec3(0.0031308), c));
  c+=(hash2(gl_FragCoord.xy)-0.5)/255.0;
  outColor=vec4(clamp(c,0.0,1.0),1.0);
}`;

function header(floatRT) {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${floatRT ? '#define FLOAT_RT 1' : ''}
`;
}

export function glslSources(floatRT) {
  const head = header(floatRT);
  const body = head + UBO + LIB;
  return {
    meshVS: body + meshVS(false),
    meshFS: body + MESH_FS,
    shadowVS: body + meshVS(true),
    shadowFS: head + 'void main(){}',
    backgroundVS: head + FULL_VS,
    backgroundFS: body + BACKGROUND_FS,
    waterVS: body + WATER_VS,
    backFS: body + BACK_FS,
    waterFS: body + WATER_FS,
    causticVS: body + CAUSTIC_VS,
    causticFS: head + CAUSTIC_FS,
    copyVS: head + FULL_VS,
    copyFS: head + UBO + COPY_FS,
    finalVS: head + FULL_VS,
    finalFS: head + UBO + 'float hash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}\n' + FINAL_FS,
  };
}
