const canvas = document.querySelector("canvas");
const image = document.querySelector("p");

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();

const params = {
  SIM_RESOLUTION: 128,
  DYE_RESOLUTION: 1024,
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
setTimeout(() => (pointer.firstMove = true), 3000);

let prevTimestamp = Date.now();
const gl = canvas.getContext("webgl");
if (!gl) {
  alert("WebGL not supported on your device.");
  throw new Error("WebGL not supported");
}
gl.getExtension("OES_texture_float");

let outputColor, velocity, divergence, pressure;

const vertexShader = createShader(
  document.getElementById("vertShader").innerHTML,
  gl.VERTEX_SHADER
);

const splatProgram = createProgram("fragShaderPoint");
const divergenceProgram = createProgram("fragShaderDivergence");
const pressureProgram = createProgram("fragShaderPressure");
const gradientSubtractProgram = createProgram("fragShaderGradientSubtract");
const advectionProgram = createProgram("fragShaderAdvection");
const displayProgram = createProgram("fragShaderDisplay");

initFBOs();
render();
image.style.opacity = "1";

// 🔄 Responsive Canvas Resizing
window.addEventListener("resize", () => {
  resizeCanvas();
  params.SPLAT_RADIUS = 5 / window.innerHeight;
});

// 🖱️ Mouse Interactions
canvas.addEventListener("click", (e) => {
  pointer.dx = 10;
  pointer.dy = 10;
  pointer.x = e.pageX;
  pointer.y = e.pageY;
  pointer.firstMove = true;
});

canvas.addEventListener("mousemove", (e) => {
  pointer.moved = true;
  pointer.dx = 5 * (e.pageX - pointer.x);
  pointer.dy = 5 * (e.pageY - pointer.y);
  pointer.x = e.pageX;
  pointer.y = e.pageY;
  pointer.firstMove = true;
});

// 📱 Touch Support for Mobile Devices
canvas.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    pointer.moved = true;
    let touch = e.targetTouches[0];
    pointer.dx = 8 * (touch.pageX - pointer.x);
    pointer.dy = 8 * (touch.pageY - pointer.y);
    pointer.x = touch.pageX;
    pointer.y = touch.pageY;
    pointer.firstMove = true;
  },
  { passive: false }
);

// 🏆 Performance Improvement - Render Throttling
let lastRenderTime = 0;
function render(timestamp) {
  if (timestamp - lastRenderTime < 16) {
    requestAnimationFrame(render);
    return;
  }
  lastRenderTime = timestamp;

  const dt = (Date.now() - prevTimestamp) / 1000;
  prevTimestamp = Date.now();

  if (!pointer.firstMove) {
    pointer.moved = true;
    pointer.x =
      (0.65 +
        0.2 *
          Math.cos(0.006 * prevTimestamp) *
          Math.sin(0.008 * prevTimestamp)) *
      window.innerWidth;
    pointer.y =
      (0.5 + 0.12 * Math.sin(0.01 * prevTimestamp)) * window.innerHeight;
  }

  if (pointer.moved) {
    pointer.moved = false;
    applySplat();
  }

  applyDivergence();
  applyPressure();
  applyGradientSubtract();
  applyAdvection(dt);

  gl.useProgram(displayProgram.program);
  gl.uniform1i(
    displayProgram.uniforms.u_output_texture,
    outputColor.read().attach(0)
  );
  blit();

  requestAnimationFrame(render);
}

// 🎨 Separated Functions for Readability
function applySplat() {
  gl.useProgram(splatProgram.program);
  gl.uniform1i(splatProgram.uniforms.u_input_txr, velocity.read().attach(0));
  gl.uniform1f(splatProgram.uniforms.u_ratio, canvas.width / canvas.height);
  gl.uniform2f(
    splatProgram.uniforms.u_point,
    pointer.x / canvas.width,
    1 - pointer.y / canvas.height
  );
  gl.uniform3f(splatProgram.uniforms.u_point_value, pointer.dx, -pointer.dy, 1);
  gl.uniform1f(splatProgram.uniforms.u_point_size, params.SPLAT_RADIUS);

  blit(velocity.write());
  velocity.swap();

  gl.uniform1i(
    splatProgram.uniforms.u_input_txr,
    outputColor.read().attach(0)
  );
  gl.uniform3f(
    splatProgram.uniforms.u_point_value,
    1 - params.color.r,
    1 - params.color.g,
    1 - params.color.b
  );
  blit(outputColor.write());
  outputColor.swap();
}

function applyDivergence() {
  gl.useProgram(divergenceProgram.program);
  gl.uniform2f(
    divergenceProgram.uniforms.u_vertex_texel,
    velocity.texelSizeX,
    velocity.texelSizeY
  );
  gl.uniform1i(
    divergenceProgram.uniforms.u_velocity_txr,
    velocity.read().attach(0)
  );
  blit(divergence);
}

function applyPressure() {
  gl.useProgram(pressureProgram.program);
  gl.uniform2f(
    pressureProgram.uniforms.u_vertex_texel,
    velocity.texelSizeX,
    velocity.texelSizeY
  );
  gl.uniform1i(pressureProgram.uniforms.u_divergence_txr, divergence.attach(0));
  for (let i = 0; i < params.PRESSURE_ITERATIONS; i++) {
    gl.uniform1i(
      pressureProgram.uniforms.u_pressure_txr,
      pressure.read().attach(1)
    );
    blit(pressure.write());
    pressure.swap();
  }
}

function applyGradientSubtract() {
  gl.useProgram(gradientSubtractProgram.program);
  gl.uniform2f(
    gradientSubtractProgram.uniforms.u_vertex_texel,
    velocity.texelSizeX,
    velocity.texelSizeY
  );
  gl.uniform1i(
    gradientSubtractProgram.uniforms.u_pressure_txr,
    pressure.read().attach(0)
  );
  gl.uniform1i(
    gradientSubtractProgram.uniforms.u_velocity_txr,
    velocity.read().attach(1)
  );
  blit(velocity.write());
  velocity.swap();
}

function applyAdvection(dt) {
  gl.useProgram(advectionProgram.program);
  gl.uniform2f(
    advectionProgram.uniforms.u_vertex_texel,
    velocity.texelSizeX,
    velocity.texelSizeY
  );
  gl.uniform1f(advectionProgram.uniforms.u_dt, dt);
  gl.uniform1f(
    advectionProgram.uniforms.u_dissipation,
    params.VELOCITY_DISSIPATION
  );

  gl.uniform1i(
    advectionProgram.uniforms.u_velocity_txr,
    velocity.read().attach(0)
  );
  gl.uniform1i(
    advectionProgram.uniforms.u_input_txr,
    velocity.read().attach(0)
  );
  blit(velocity.write());
  velocity.swap();
}

