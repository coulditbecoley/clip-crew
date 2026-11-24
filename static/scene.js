// The hero: a real-time sunset over the bay, drawn by one fragment shader, with a far
// skyline and a little mouse parallax. If WebGL is missing, the CSS gradient under it stays.
(() => {
  const sky = document.querySelector(".sky"), cv = document.getElementById("scene");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const HORIZON = 0.34;   // fraction of the hero height, from the bottom. Matches --horizon in style.css

  /* the city across the bay: glass towers with lit floors and neon crowns, built once from a fixed seed */
  const holder = document.querySelector(".skyline");
  if (holder) {
    let seed = 23; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const W = 1000, H = 200, PX = 2.6, PY = 3.6, f = n => n.toFixed(1), pick = a => a[Math.floor(rnd() * a.length)];
    const LIGHT = { w: "#ffe9c4", p: "#ff7fd0", b: "#8fc8ff" }, NEON = ["#ff3db8", "#c44dff", "#3d8bff", "#ff6bd6", "#ffd9f2"];
    // window tiles: a few floors of lit and dark panes, repeated up each tower
    let tiles = "";
    for (const c in LIGHT) for (const [d, lit] of [["s", .42], ["d", .8]]) {
      let r = "";
      for (let i = 0; i < 10; i++) for (let k = 0; k < 10; k++) if (rnd() < lit) r += `<rect x="${f(i * PX + .5)}" y="${f(k * PY + .8)}" width="1.6" height="2" opacity="${f(.5 + rnd() * .5)}"/>`;
      tiles += `<pattern id="${c}${d}ID" width="${PX * 10}" height="${PY * 10}" patternUnits="userSpaceOnUse"><g fill="${LIGHT[c]}">${r}</g></pattern>`;
    }
    const env = x => Math.max(Math.exp(-(((x - 250) / 150) ** 2)) * .8, Math.exp(-(((x - 520) / 120) ** 2)), Math.exp(-(((x - 800) / 130) ** 2)) * .75);
    let streaks = "";
    function row(near) {
      let x = near ? 14 : 0, out = "";
      while (x < W - 24) {
        const e = env(x + 18), tall = rnd() < .2 + e * .6, c = pick(["w", "w", "w", "p", "b"]);
        const w = near ? 18 + rnd() * 20 : 14 + rnd() * 18;
        const h = Math.min(H - 10, (near ? 14 : 22) + rnd() * 18 + e * (tall ? 80 + rnd() * 90 : 20 + rnd() * 44) * (near ? .88 : 1));
        const y = H - h, fill = `url(#${near ? "n" : "f"}ID)`;
        out += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}"/>`;
        let top = y;
        if (tall && rnd() < .4) { const tw = w * (.5 + rnd() * .3), th = 5 + rnd() * 10; top = y - th; out += `<rect x="${f(x + (w - tw) / 2)}" y="${f(top)}" width="${f(tw)}" height="${f(th + 1)}" fill="${fill}"/>`; }
        if (tall && rnd() < .3) { const mh = 8 + rnd() * 16; out += `<rect x="${f(x + w / 2 - .6)}" y="${f(top - mh)}" width="1.2" height="${f(mh)}" fill="${fill}"/>`; }
        // lit floors, snapped to the shared window grid so no pane is cut by a wall
        const wx = Math.ceil((x + 1.5) / PX) * PX, ww = Math.floor((x + w - 1.5 - wx) / PX) * PX;
        if (ww > 0) out += `<rect x="${wx}" y="${f(y + 4)}" width="${ww}" height="${f(h - 5)}" fill="url(#${c}${rnd() < .45 ? "d" : "s"}ID)" opacity="${near ? 1 : .4}"/>`;
        if (near) {
          const neon = pick(NEON);
          if (rnd() < .22) out += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${neon}" opacity=".22"/>`;   // a tower washed in colour
          if (tall && rnd() < .7) out += `<rect x="${f(x - 2)}" y="${f(y - 4)}" width="${f(w + 4)}" height="9" fill="${neon}" opacity=".55" filter="url(#gID)"/><rect x="${f(x)}" y="${f(y - .6)}" width="${f(w)}" height="2.6" fill="${neon}"/><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height=".9" fill="#fff" opacity=".8"/>`;
          streaks += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${tall ? neon : LIGHT[c]}" opacity="${tall ? .34 : 0}"/>`;
        }
        x += w + (rnd() < .2 ? 2 + rnd() * 10 : -2 - rnd() * 4);
      }
      return out;
    }
    const far = row(false), near = row(true);
    let shore = "";
    for (let x = 4; x < W; x += 3 + rnd() * 7) shore += `<circle cx="${f(x)}" cy="${H - 3.4}" r="${f(.7 + rnd() * .6)}" fill="${pick(["#ffe9c4", "#ffe9c4", "#ff7fd0", "#8fc8ff"])}"/>`;
    const svg = (cls, id) => `<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs>${tiles.replaceAll("ID", id)}
      <linearGradient id="f${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b2a72"/><stop offset="1" stop-color="#a9506f"/></linearGradient>
      <linearGradient id="n${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a0b33"/><stop offset=".75" stop-color="#2c1147"/><stop offset="1" stop-color="#55204f"/></linearGradient>
      <filter id="g${id}" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="3"/></filter>
      <filter id="r${id}" x="-5%" width="110%"><feTurbulence type="fractalNoise" baseFrequency=".008 .24" numOctaves="2" seed="4" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="18" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="1.6 .6"/></filter></defs>
      <g ${cls ? `filter="url(#r${id})"` : ""}><g opacity=".8">${far.replaceAll("ID", id)}</g>${near.replaceAll("ID", id)}
      <rect y="${H - 6}" width="${W}" height="6" fill="#1a0b33"/>${shore}${cls ? streaks : ""}</g></svg>`;
    holder.innerHTML = svg("", "a") + svg("mirror", "b");
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
  vec3 c=mix(vec3(.95,.64,.38),vec3(.99,.42,.36),smoothstep(0.,.06,h));
  c=mix(c,vec3(.66,.15,.52),smoothstep(.04,.22,h));
  c=mix(c,vec3(.22,.07,.40),smoothstep(.18,.46,h));
  c=mix(c,vec3(.055,.022,.15),smoothstep(.4,.95,h));
  float sd=max(dot(d,sun),0.);
  c+=vec3(1.,.5,.2)*pow(sd,6.)*.22;
  c+=vec3(1.,.76,.46)*pow(sd,40.)*.28;
  if(clouds>0.){
    vec2 cp=d.xz/(d.y+.18)*1.6+vec2(T*.006,T*.002);
    float cl=smoothstep(.46,.78,fbm(cp))*smoothstep(.012,.11,h)*(1.-smoothstep(.5,.92,h));
    vec3 cc=mix(vec3(.27,.09,.33),vec3(1.,.56,.42),pow(sd,3.)*.9+.12*(1.-h));
    c=mix(c,cc,cl*.78*clouds);
  }
  c=mix(c,vec3(1.,.84,.58),smoothstep(.9971,.9981,sd));
  c+=vec3(1.,.8,.55)*smoothstep(.985,.9995,sd)*.18;
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
