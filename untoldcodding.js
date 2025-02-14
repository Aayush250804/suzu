const canvas = document.querySelector("canvas");
const image = document.querySelector("p");
canvas.width = canvas.clientWidth;
canvas.height = canvas.clientHeight;

const gl = canvas.getContext("webgl");
const ext = gl.getExtension("OES_texture_float") || gl.getExtension("EXT_color_buffer_float");
if (!ext) {
  console.error("Floating point textures not supported!");
}

const params = {
  SIM_RESOLUTION: window.devicePixelRatio < 2 ? 64 : 128,
  DYE_RESOLUTION: window.devicePixelRatio < 2 ? 512 : 1024,
  DENSITY_DISSIPATION: 0.995,
  VELOCITY_DISSIPATION: 0.9,
  PRESSURE_ITERATIONS: 10,
  SPLAT_RADIUS: 3 / window.innerHeight,
  color: { r: 0.8, g: 0.5, b: 0.2 },
};

const pointer = {
  x: 0.65 * window.innerWidth,
  y: 0.5 * window.innerHeight,
  dx: 0,
  dy: 0,
  moved: false,
  firstMove: false,
};
setTimeout(() => pointer.firstMove = true, 3000);

let prevTimestamp = performance.now();

let outputColor, velocity, divergence, pressure;
const vertexShader = createShader("vertShader", gl.VERTEX_SHADER);
const splatProgram = createProgram("fragShaderPoint");
const divergenceProgram = createProgram("fragShaderDivergence");
const pressureProgram = createProgram("fragShaderPressure");
const gradientSubtractProgram = createProgram("fragShaderGradientSubtract");
const advectionProgram = createProgram("fragShaderAdvection");
const displayProgram = createProgram("fragShaderDisplay");

initFBOs();
render();
image.style.opacity = "1";

window.addEventListener("resize", () => {
  params.SPLAT_RADIUS = 5 / window.innerHeight;
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
});

document.body.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

canvas.addEventListener("mousemove", (e) => {
  pointer.moved = true;
  pointer.dx = 0.9 * (e.pageX - pointer.x);
  pointer.dy = 0.9 * (e.pageY - pointer.y);
  pointer.x = e.pageX;
  pointer.y = e.pageY;
  pointer.firstMove = true;
});

function createProgram(elId) {
  const shader = createShader(elId, gl.FRAGMENT_SHADER);
  const program = createShaderProgram(vertexShader, shader);
  return { program, uniforms: getUniforms(program) };
}

function createShader(elId, type) {
  const source = document.getElementById(elId).innerHTML;
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compilation failed: ", gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

function render() {
  const now = performance.now();
  const dt = (now - prevTimestamp) / 1000;
  prevTimestamp = now;

  if (!pointer.firstMove) {
    pointer.moved = true;
    pointer.x = (0.65 + 0.2 * Math.cos(0.006 * now)) * window.innerWidth;
    pointer.y = (0.5 + 0.12 * Math.sin(0.01 * now)) * window.innerHeight;
    pointer.dx *= 0.9;
    pointer.dy *= 0.9;
  }

  if (pointer.moved) {
    pointer.moved = false;
    gl.useProgram(splatProgram.program);
    gl.uniform2f(splatProgram.uniforms.u_point, pointer.x / canvas.width, 1 - pointer.y / canvas.height);
    gl.uniform3f(splatProgram.uniforms.u_point_value, pointer.dx, -pointer.dy, 1);
    blit(velocity.write());
    velocity.swap();
    gl.uniform1i(splatProgram.uniforms.u_input_txr, outputColor.read().attach(0));
    gl.uniform3f(splatProgram.uniforms.u_point_value, 1 - params.color.r, 1 - params.color.g, 1 - params.color.b);
    blit(outputColor.write());
    outputColor.swap();
  }
  
  gl.useProgram(displayProgram.program);
  gl.uniform1i(displayProgram.uniforms.u_output_texture, outputColor.read().attach(0));
  blit();
  requestAnimationFrame(render);
}
