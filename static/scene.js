// The hero: a real-time sunset over the bay, drawn by one fragment shader, with a far
// skyline and a little mouse parallax. If WebGL is missing, the CSS gradient under it stays.
(() => {
  const sky = document.querySelector(".sky"), cv = document.getElementById("scene");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const HORIZON = 0.34;   // fraction of the hero height, from the bottom. Matches --horizon in style.css

  /* far skyline, drawn once from a fixed seed so it never changes between visits */
  const holder = document.querySelector(".skyline");
  if (holder) {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let x = 0, shapes = "", lights = "";
    while (x < 1000) {
      const centre = 1 - Math.abs(x - 430) / 620, w = 14 + rnd() * 30, h = 10 + rnd() * 26 + Math.max(0, centre) ** 2 * (30 + rnd() * 62);
      shapes += `<rect x="${x.toFixed(1)}" y="${(120 - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"/>`;
      if (rnd() > .55) shapes += `<rect x="${(x + w * .3).toFixed(1)}" y="${(120 - h - 6 - rnd() * 8).toFixed(1)}" width="${(w * .4).toFixed(1)}" height="16"/>`;
      for (let k = 0; k < h / 9; k++) if (rnd() > .45) lights += `<rect x="${(x + 3 + rnd() * (w - 7)).toFixed(1)}" y="${(120 - h + 4 + rnd() * (h - 8)).toFixed(1)}" width="2" height="2.4"/>`;
      x += w + (rnd() > .8 ? 6 + rnd() * 26 : 1);
    }
    const svg = cls => `<svg class="${cls}" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true"><g fill="#5a1d6e">${shapes}</g><g fill="#ffe2b0">${lights}</g></svg>`;
    holder.innerHTML = svg("") + svg("mirror");
  }

  /* parallax: the foreground moves more than the far shore */
  let tx = 0, ty = 0, mx = 0, my = 0;
  if (!still) sky.addEventListener("pointermove", e => { const r = sky.getBoundingClientRect(); tx = (e.clientX - r.left) / r.width * 2 - 1; ty = (e.clientY - r.top) / r.height * 2 - 1; });

  const gl = cv.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
  if (!gl) { cv.remove(); return; }
  const FRAG = `precision highp float;
uniform vec2 R; uniform float T; uniform vec2 M; uniform float H;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*noise(p);p=p*2.02+vec2(3.1,1.7);a*=.5;}return s;}
float swell(vec2 p){float a=.5,s=0.;for(int i=0;i<3;i++){s+=a*noise(p);p=p*2.02+vec2(3.1,1.7);a*=.5;}return s;}
float sea(vec2 q,float t){return swell(q+vec2(t*.3,t))+.5*swell(q*2.3-vec2(t*.2,t*1.4));}
vec3 sky(vec3 d,vec3 sun,float clouds){
  float h=max(d.y,0.);
  vec3 c=mix(vec3(1.,.76,.42),vec3(.99,.42,.36),smoothstep(0.,.06,h));
  c=mix(c,vec3(.66,.15,.52),smoothstep(.04,.22,h));
  c=mix(c,vec3(.22,.07,.40),smoothstep(.18,.46,h));
  c=mix(c,vec3(.055,.022,.15),smoothstep(.4,.95,h));
  float sd=max(dot(d,sun),0.);
  c+=vec3(1.,.5,.2)*pow(sd,6.)*.34;
  c+=vec3(1.,.76,.46)*pow(sd,40.)*.5;
  if(clouds>0.){
    vec2 cp=d.xz/(d.y+.18)*1.6+vec2(T*.006,T*.002);
    float cl=smoothstep(.46,.78,fbm(cp))*smoothstep(.012,.11,h)*(1.-smoothstep(.5,.92,h));
    vec3 cc=mix(vec3(.27,.09,.33),vec3(1.,.56,.42),pow(sd,3.)*.9+.12*(1.-h));
    c=mix(c,cc,cl*.78*clouds);
  }
  c=mix(c,vec3(1.,.96,.80),smoothstep(.9971,.9981,sd));
  c+=vec3(1.,.85,.6)*smoothstep(.985,.9995,sd)*.36;
  return c;
}
void main(){
  vec2 uv=(gl_FragCoord.xy-vec2(.5*R.x,H*R.y))/R.y;
  vec3 sun=normalize(vec3(.46,.07,1.));
  vec3 rd=normalize(vec3(uv.x+M.x*.03,uv.y-M.y*.008,1.35));
  vec3 col;
  if(rd.y>0.){ col=sky(rd,sun,1.); }
  else{
    float d=1.1/max(-rd.y,.0005);
    vec2 q=rd.xz*d*vec2(.9,.5);
    float k=1./(1.+d*.06), t=T*.35, e=.08;
    float h0=sea(q,t), hx=sea(q+vec2(e,0.),t), hz=sea(q+vec2(0.,e),t);
    vec3 n=normalize(vec3(-(hx-h0)/e*.55*k,1.,-(hz-h0)/e*.55*k));
    vec3 rf=reflect(rd,n); rf.y=abs(rf.y)+.002; rf=normalize(rf);
    float fr=pow(1.-max(dot(-rd,n),0.),4.);
    col=mix(vec3(.05,.02,.12),sky(rf,sun,.5),.34+.66*fr);
    col=mix(col,sky(normalize(vec3(rd.x,.001,rd.z)),sun,0.),smoothstep(30.,230.,d)*.85);
  }
  vec2 v=gl_FragCoord.xy/R-.5; col*=1.-dot(v,v)*.32;
  gl_FragColor=vec4(pow(col,vec3(.95)),1.);
}`;
  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = shader(gl.VERTEX_SHADER, "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}"), fs = shader(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs) { cv.remove(); return; }
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { cv.remove(); return; }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(prog, n), uR = U("R"), uT = U("T"), uM = U("M"), uH = U("H");

  function size() {   // a soft sky does not need full resolution; this keeps weak GPUs happy
    const w = Math.min(1400, Math.round(cv.clientWidth * .7)), h = Math.round(w * cv.clientHeight / Math.max(cv.clientWidth, 1));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }
  }
  let visible = true, raf = 0;
  const start = performance.now() - 40000;   // begin mid-drift so the clouds are already spread out
  function frame(now) {
    raf = 0; size();
    mx += (tx - mx) * .06; my += (ty - my) * .06;
    sky.style.setProperty("--px", mx.toFixed(3)); sky.style.setProperty("--py", my.toFixed(3));
    gl.uniform2f(uR, cv.width, cv.height); gl.uniform1f(uT, (now - start) / 1000); gl.uniform2f(uM, mx, my); gl.uniform1f(uH, HORIZON);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (visible && !still && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) kick(); }).observe(sky);
  document.addEventListener("visibilitychange", kick);
  new ResizeObserver(kick).observe(cv);
  kick();
})();
