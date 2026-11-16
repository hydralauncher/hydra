import { useEffect, type RefObject } from "react";

const VERTEX_SHADER =
  "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

const FRAGMENT_SHADER = [
  "precision highp float;",
  "uniform vec2 uRes;uniform float uTime;uniform float uDpr;uniform float uBw;uniform float uHover;",
  "float beam(float a,float p,float w){float d=abs(fract(a-p+.5)-.5);float e=abs(fract(a-p)-.5);return exp(-d*d/(w*w))+.55*exp(-e*e/(w*w*1.4));}",
  "const float ANGLE=70.0;const float REP=2.0;const float SHR=0.3;const float SHB=0.3;const float DIST=0.07;",
  "float sdRR(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}",
  "vec3 metal(float t){float f=fract(t);",
  " vec3 a=vec3(0.957,0.957,0.965),b=vec3(0.725,0.733,0.757),c=vec3(0.424,0.431,0.455),d=vec3(0.851,0.855,0.871);",
  " vec3 col=f<.25?mix(a,b,smoothstep(0.,.25,f)):f<.5?mix(b,c,smoothstep(.25,.5,f)):f<.75?mix(c,d,smoothstep(.5,.75,f)):mix(d,a,smoothstep(.75,1.,f));",
  " col+=pow(max(0.,sin(f*6.2832)),6.)*0.3;return col;}",
  "void main(){vec2 px=gl_FragCoord.xy;vec2 c=uRes*.5;float r=8.*uDpr;float pad=10.*uDpr;",
  " float d=sdRR(px-c,c-pad,r);float bw=uBw*uDpr;float fe=1.1*uDpr;",
  " float ring=smoothstep(-bw-fe,-bw+fe,d)*(1.-smoothstep(-fe*.6,fe,d));",
  " float halo=exp(-abs(d+bw*.5)/(3.5*uDpr));float inner=exp(d/(16.*uDpr))*step(d,0.);",
  " vec2 uv=(px-c)/uRes.y;float a=radians(ANGLE);vec2 dir=vec2(cos(a),sin(a));",
  " float ang=atan(px.y-c.y,(px.x-c.x)*uRes.y/uRes.x)/6.2832;",
  " float w=DIST*(sin(uv.x*3.+uTime*.5)*cos(uv.y*2.5-uTime*.35))*3.;",
  " float t=ang*REP+dot(uv,dir)*.25*REP+w+uTime*.04;",
  " float bwid=mix(.075,.12,uHover);float p0=uTime*.06+w*.4;",
  " vec3 hl=vec3(beam(ang+SHR*.025,p0,bwid),beam(ang,p0,bwid),beam(ang-SHB*.025,p0,bwid));",
  " float h=hl.g;",
  " vec3 col=metal(t)*(.30+.22*uHover)+hl*metal(t+.35)*1.25;",
  " col=min(col,vec3(1.));",
  " float al=ring*(.40+.60*h+.25*uHover)+halo*(.04+.38*h)*(1.+.6*uHover)+inner*(.03+.07*uHover);",
  " al=clamp(al,0.,1.);",
  " gl_FragColor=vec4(col*al,al);}",
].join("\n");

const BORDER_WIDTH = 1.5;
const SPEED = 1;
const REDUCED_MOTION_TIME = 2.84;
const MAX_DEVICE_PIXEL_RATIO = 2;
const MAX_FRAME_SECONDS = 0.05;
const HOVER_EASING = 7;
const HOVER_SPEED_BOOST = 1.2;
const HOVER_SETTLED = 0.001;

export function useNeoSidebarBorder(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  hoverRef: RefObject<number | null>
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", {
      premultipliedAlpha: true,
      alpha: true,
      antialias: true,
    });
    if (!canvas || !gl || gl.isContextLost()) return;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uDpr = gl.getUniformLocation(program, "uDpr");
    const uBw = gl.getUniformLocation(program, "uBw");
    const uHover = gl.getUniformLocation(program, "uHover");

    const resize = () => {
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        MAX_DEVICE_PIXEL_RATIO
      );
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uRes, width, height);
      gl.uniform1f(uDpr, dpr);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    let hover = 0;
    let time = REDUCED_MOTION_TIME;
    let last = performance.now();
    let frameId = 0;

    const frame = (now: number) => {
      const target = hoverRef.current ?? 0;
      const elapsed = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
      hover = reduced
        ? target
        : hover + (target - hover) * (1 - Math.exp(-elapsed * HOVER_EASING));
      const settling = Math.abs(target - hover) > HOVER_SETTLED;
      const speed = (reduced ? 0 : SPEED) * (1 + HOVER_SPEED_BOOST * hover);
      time += elapsed * speed;
      last = now;

      resize();
      gl.uniform1f(uHover, hover);
      gl.uniform1f(uBw, BORDER_WIDTH);
      gl.uniform1f(uTime, time);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      frameId = speed > 0 || settling ? requestAnimationFrame(frame) : 0;
    };

    frameId = requestAnimationFrame(frame);

    const kick = () => {
      if (frameId) return;
      last = performance.now();
      frameId = requestAnimationFrame(frame);
    };
    canvas.addEventListener("neo-hover", kick);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      canvas.removeEventListener("neo-hover", kick);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [canvasRef, hoverRef]);
}
