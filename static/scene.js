// The hero: a real-time sunset over the bay, drawn by one fragment shader, with a far
// skyline and a little mouse parallax. If WebGL is missing, the CSS gradient under it stays.
(() => {
  const sky = document.querySelector(".sky"), cv = document.getElementById("scene");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const HORIZON = 0.34;   // fraction of the hero height, from the bottom. Matches --horizon in style.css

  /* the city across the bay: two rows of towers in sunset haze, built once from a fixed seed */
  const holder = document.querySelector(".skyline");
  if (holder) {
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const W = 1000, H = 200, f = n => n.toFixed(1);
    // downtown clusters: where the tall towers bunch up
    const env = x => Math.max(Math.exp(-(((x - 300) / 120) ** 2)) * .8, Math.exp(-(((x - 560) / 95) ** 2)), Math.exp(-(((x - 790) / 110) ** 2)) * .55);
    function row(near) {
      let x = near ? 20 : 0, out = "", glow = "";
      while (x < W - 20) {
        const e = env(x + 15), tall = rnd() < .25 + e * .5;
        const w = near ? 16 + rnd() * 26 : 12 + rnd() * 22;
        let h = (near ? 12 : 18) + rnd() * 16 + e * (tall ? 70 + rnd() * 80 : 20 + rnd() * 40) * (near ? .82 : 1);
        h = Math.min(h, H - 8);
        const y = H - h, fill = `url(#${near ? "n" : "f"}ID)`;
        out += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}"/>`;
        let top = y, tw = w, tx = x;
        if (tall) {   // setbacks, then a crown, mast or slanted roof
          for (let k = 0, n = Math.floor(rnd() * 3); k < n; k++) {
            const th = 5 + rnd() * 12; tw *= .62 + rnd() * .2; tx = x + (w - tw) * (.3 + rnd() * .4); top -= th;
            out += `<rect x="${f(tx)}" y="${f(top)}" width="${f(tw)}" height="${f(th + 1)}" fill="${fill}"/>`;
          }
          const style = rnd();
          if (style < .35) { const mh = 10 + rnd() * 22; out += `<rect x="${f(tx + tw / 2 - .7)}" y="${f(top - mh)}" width="1.4" height="${f(mh)}" fill="${fill}"/>`; if (near) glow += `<circle cx="${f(tx + tw / 2)}" cy="${f(top - mh)}" r="1.5" fill="#ff5a6e"/>`; }
          else if (style < .55) out += `<path d="M${f(tx)} ${f(top + 1)}L${f(tx + tw)} ${f(top + 1)}L${f(tx + tw)} ${f(top - 4 - rnd() * 8)}Z" fill="${fill}"/>`;
          else if (style < .7) out += `<path d="M${f(tx)} ${f(top + 1)}Q${f(tx + tw / 2)} ${f(top - tw * .5)} ${f(tx + tw)} ${f(top + 1)}Z" fill="${fill}"/>`;
        } else if (rnd() < .5) out += `<rect x="${f(x + w * .2)}" y="${f(y - 3)}" width="${f(w * .3)}" height="4" fill="${fill}"/>`;   // rooftop plant
        // the sun sits to the right, so right-hand faces catch it
        out += `<rect x="${f(x + w - (near ? 2.4 : 1.6))}" y="${f(y)}" width="${near ? 2.4 : 1.6}" height="${f(h)}" fill="#ffb27a" opacity="${near ? .5 : .32}"/>`;
        if (near) {   // lit windows on a regular grid, floor by floor
          const cols = Math.floor((w - 6) / 4.6), rows = Math.floor((h - 8) / 6.2), lit = .18 + rnd() * .3;
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (rnd() < lit)
            glow += `<rect x="${f(x + 3 + c * 4.6)}" y="${f(y + 5 + r * 6.2)}" width="2.4" height="3.2" fill="${rnd() < .8 ? "#ffd9a0" : "#bfe9ff"}" opacity="${f(.55 + rnd() * .45)}"/>`;
        }
        x += w + (rnd() < .22 ? 3 + rnd() * 14 : -1 - rnd() * 3);
      }
      return out + glow;
    }
    const far = row(false), near = row(true);
    const svg = (cls, id) => `<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs>
      <linearGradient id="f${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7d3384"/><stop offset="1" stop-color="#d0637f"/></linearGradient>
      <linearGradient id="n${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1046"/><stop offset=".7" stop-color="#4f1d62"/><stop offset="1" stop-color="#8a3570"/></linearGradient>
      <linearGradient id="h${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a6a" stop-opacity="0"/><stop offset="1" stop-color="#ff9a6a" stop-opacity=".55"/></linearGradient>
      <filter id="r${id}" x="-5%" width="110%"><feTurbulence type="fractalNoise" baseFrequency=".012 .3" numOctaves="2" seed="4" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="16" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="1.4 .5"/></filter></defs>
      <g ${cls ? `filter="url(#r${id})"` : ""}><g opacity=".85">${far.replaceAll("ID", id)}</g>${near.replaceAll("ID", id)}
      <rect y="${H - 5}" width="${W}" height="5" fill="#2a1046"/><rect y="${H - 46}" width="${W}" height="46" fill="url(#h${id})"/></g></svg>`;
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
