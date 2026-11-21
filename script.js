const $ = id => document.getElementById(id);
const world = $("game-world");

if (!window.THREE) {
  $("loading-screen").innerHTML =
    "<div class='loading-card'><p>Unable to load Three.js. Check your internet connection and refresh.</p></div>";
  throw new Error("Three.js could not be loaded.");
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe99a70);
scene.fog = new THREE.Fog(0xe99a70, 45, 110);

const camera = new THREE.PerspectiveCamera(
  74,
  window.innerWidth / window.innerHeight,
  0.1,
  180
);

camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

world.appendChild(renderer.domElement);

const PLAYER_HEIGHT = 1.65;
const PLAYER_RADIUS = 0.30;
const FLOOR_HEIGHT = 4;

const FLOOR_Y = {
  3: 0,
  2: -4,
  1: -8
};

let currentFloor = 3;
let buildingFloor = 3;

let teacherHitEffectTime = 0;
let teacherShakeTime = 0;
let teacherHitCooldown = 0;

let playerPosition = new THREE.Vector3(0, PLAYER_HEIGHT, 4.8);

let yaw = Math.PI;
let pitch = 0;

let gameStarted = false;
let gamePaused = false;
let gameFinished = false;
let pointerLocked = false;

let teacherChaseCooldown = 0;
let nextTeacherToChase = "teacherA";
let score = 0;
let timeLeft = 510;
let lives = 3;

let carriedDocuments = null;
const acceptedFavors = new Set();
const completedFavors = new Set();
const favorRewards = {};
let watchExamInterval = null;
let watchExamTimeLeft = 30;

let examArrivalInterval = null;
let examArrivalTimeLeft = 10;

let teacherCItemCollected = false;

let activeInteraction = null;
let nearbyObject = null;

let challengeIndex = 0;
let challengeCorrect = 0;
let challengeAnswered = false;

let verticalVelocity = 0;
let isJumping = false;
let stairBlockedNotice = false;

const GRAVITY = 18;
const JUMP_FORCE = 6.5;

const examStudents = [];

const keys = {};
const colliders = [];
const interactables = [];
const ambientNPCs = [];
const movingTeachers = [];
const doors = [];
const seatSpots = [];
let seatedOnChair = false;
let currentSeat = null;

let interactionReturnPosition = null;
let interactionReturnYaw = 0;
let interactionReturnPitch = 0;
const completedTasks = new Set();

const clock = new THREE.Clock();

let timerInterval = null;
let toastTimeout = null;

// ============================================================
// MATERIALS
// ============================================================

function mat(color, roughness = 0.82, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    ...options
  });
}

const M = {
  wall: mat(0xe9e2d7),
  wallAccent: mat(0xcfc1ae),
  wallDark: mat(0x9b8772),

  floor: mat(0xb7a48e),
  tile: mat(0xd4ccc0),
  ceiling: mat(0xf5f0e7),

  wood: mat(0x805c3e),
  woodLight: mat(0xb58a60),
  woodDark: mat(0x533a2a),

  metal: mat(0x59646a, 0.38, { metalness: 0.55 }),
  black: mat(0x20272a, 0.4),

  screen: mat(0x6d969d, 0.3, {
    emissive: 0x25464b,
    emissiveIntensity: 0.65
  }),

  glass: new THREE.MeshPhysicalMaterial({
    color: 0xffc08a,
    roughness: 0.10,
    metalness: 0.08,
    transparent: true,
    opacity: 0.43,
    emissive: 0x8f3e1b,
    emissiveIntensity: 0.22,
    side: THREE.DoubleSide
  }),

  white: mat(0xf2eee5),
  green: mat(0x55745f),
  blue: mat(0x536c82),
  orange: mat(0xb97849),

  skin: mat(0xc89574),
  hair: mat(0x30251f),

  paper: mat(0xf7f2e8),
  board: mat(0x42604f),
  plant: mat(0x476b4d)
};

const wireMaterials = {
  red: mat(0xd82f36),
  blue: mat(0x2877d4),
  yellow: mat(0xf1c232),
  green: mat(0x318b54)
};

// ============================================================
// GOLDEN HOUR LIGHTING
// ============================================================

scene.add(
  new THREE.HemisphereLight(0xffdfbd, 0x554044, 1.45)
);

const sunlight = new THREE.DirectionalLight(0xffa85f, 3.25);

sunlight.position.set(-25, 18, 12);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(1024, 1024);

sunlight.shadow.camera.left = -40;
sunlight.shadow.camera.right = 40;
sunlight.shadow.camera.top = 35;
sunlight.shadow.camera.bottom = -35;

scene.add(sunlight);

const sunGlow = new THREE.PointLight(0xff9148, 105, 90);
sunGlow.position.set(-25, 7, -5);
scene.add(sunGlow);

const sunsetFill = new THREE.DirectionalLight(0xffc080, 0.85);
sunsetFill.position.set(-12, 7, 5);
scene.add(sunsetFill);

// ============================================================
// BASIC BUILDING FUNCTIONS
// ============================================================

function addCollider(x, z, w, d) {
  colliders.push({
    floor: buildingFloor,
    minX: x - w / 2,
    maxX: x + w / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2
  });
}

function addBox(
  w, h, d,
  material,
  x, y, z,
  collision = false
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    material
  );

  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  scene.add(mesh);

  if (collision) {
    addCollider(x, z, w, d);
  }

  return mesh;
}

function addWall(w, h, d, x, y, z) {
  return addBox(w, h, d, M.wall, x, y, z, true);
}

function addCeilingLight(x, y, z) {
  const light = new THREE.PointLight(0xffedcf, 12, 10);

  light.position.set(x, y - 0.3, z);
  scene.add(light);

  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.07, 0.35),
    mat(0xfff8e7, 0.35, {
      emissive: 0xffe7b5,
      emissiveIntensity: 0.6
    })
  );

  lamp.position.set(x, y, z);
  scene.add(lamp);
}

function addLabel(text, x, y, z, rotation = 0) {
  const canvas = document.createElement("canvas");

  canvas.width = 512;
  canvas.height = 128;

  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#e9e1d4";
  ctx.fillRect(0, 0, 512, 128);

  ctx.fillStyle = "#493c30";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 34px Arial";

  ctx.fillText(text, 256, 64, 460);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.05, 0.50),
    new THREE.MeshBasicMaterial({ map: texture })
  );

  sign.position.set(x, y, z);
  sign.rotation.y = rotation;

  scene.add(sign);
}

function addPoster(text, x, y, z, rotation = 0) {
  const canvas = document.createElement("canvas");

  canvas.width = 512;
  canvas.height = 512;

  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#526b58";
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = "#f4eadb";
  ctx.fillRect(18, 18, 476, 476);

  ctx.fillStyle = "#705a45";
  ctx.font = "bold 34px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const words = text.split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    const test = line ? line + " " + word : word;

    if (ctx.measureText(test).width > 390) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }

  if (line) lines.push(line);

  lines.forEach((part, index) => {
    ctx.fillText(
      part,
      256,
      256 + (index - (lines.length - 1) / 2) * 48
    );
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const poster = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 1.2),
    new THREE.MeshBasicMaterial({ map: texture })
  );

  poster.position.set(x, y, z);
  poster.rotation.y = rotation;

  scene.add(poster);
}

// ============================================================
// OUTDOOR SCENERY
// ============================================================

function buildOutdoorView() {
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 75),
    new THREE.MeshBasicMaterial({
      color: 0xe77b52,
      side: THREE.DoubleSide
    })
  );

  sky.position.set(-29, 13, -4);
  sky.rotation.y = Math.PI / 2;

  scene.add(sky);

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(2.5, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd477 })
  );

  sun.position.set(-29, 5, -7);
  scene.add(sun);

  const skyline = [
    { x: -24, z: -9, w: 9, h: 22, c: 0x73545a },
    { x: -31, z: 0, w: 10, h: 27, c: 0x66505b },
    { x: -23, z: 9, w: 8, h: 19, c: 0x815b5b },

    { x: 24, z: -9, w: 9, h: 24, c: 0x73545a },
    { x: 31, z: 0, w: 10, h: 28, c: 0x66505b },
    { x: 23, z: 9, w: 8, h: 20, c: 0x815b5b }
  ];

  skyline.forEach(item => {
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(item.w, item.h, 7),
      mat(item.c)
    );

    tower.position.set(
      item.x,
      item.h / 2 - 4.5,
      item.z
    );

    tower.castShadow = true;
    scene.add(tower);
  });

  addBox(150, 0.2, 90, mat(0x70545a), 0, -8.5, -35);
}

buildOutdoorView();

// ============================================================
// WINDOWS WITH SUNSET REFLECTION
// ============================================================

function addExteriorWindow(side, z, y, width = 2.8, height = 1.85) {
  const frameX = side * 9.79;
  const glassX = side * 9.86;

  addBox(0.045, height, width, M.glass, glassX, y, z);

  addBox(
    0.025,
    height * 0.78,
    width * 0.12,
    mat(0xffd39a, 0.18, {
      emissive: 0xff9a4d,
      emissiveIntensity: 0.38,
      transparent: true,
      opacity: 0.42
    }),
    glassX - side * 0.035,
    y,
    z - width * 0.30
  );

  addBox(0.14, 0.10, width + 0.20, M.white, frameX, y + height / 2, z);
  addBox(0.14, 0.10, width + 0.20, M.white, frameX, y - height / 2, z);

  addBox(0.14, height + 0.12, 0.10, M.white, frameX, y, z - width / 2);
  addBox(0.14, height + 0.12, 0.10, M.white, frameX, y, z + width / 2);

  addBox(0.16, height, 0.065, M.white, frameX, y, z);
  addBox(0.16, 0.065, width, M.white, frameX, y, z);

  addBox(
    0.32,
    0.12,
    width + 0.30,
    M.woodLight,
    side * 9.68,
    y - height / 2 - 0.06,
    z
  );
}

function addHallwayWindow(z, y, width = 2.0, height = 1.55) {
  addBox(width, height, 0.045, M.glass, 0, y, z);

  addBox(width + 0.16, 0.09, 0.14, M.white, 0, y + height / 2, z);
  addBox(width + 0.16, 0.09, 0.14, M.white, 0, y - height / 2, z);

  addBox(0.09, height + 0.12, 0.14, M.white, -width / 2, y, z);
  addBox(0.09, height + 0.12, 0.14, M.white, width / 2, y, z);

  addBox(0.09, height, 0.07, M.white, 0, y, z);
  addBox(width, 0.065, 0.07, M.white, 0, y, z);

  addBox(
    width + 0.30,
    0.12,
    0.30,
    M.woodLight,
    0,
    y - height / 2 - 0.06,
    z
  );
}

// ============================================================
// FURNITURE
// ============================================================

function makeDesk(x, baseY, z, width = 1.55) {
  const topY = baseY + 0.82;

  addBox(width, 0.13, 0.9, M.wood, x, topY, z, true);

  addBox(
    width + 0.05,
    0.045,
    0.95,
    M.woodDark,
    x,
    topY - 0.07,
    z
  );

  for (const dx of [-width / 2 + 0.12, width / 2 - 0.12]) {
    for (const dz of [-0.32, 0.32]) {
      addBox(
        0.065,
        0.78,
        0.065,
        M.metal,
        x + dx,
        baseY + 0.39,
        z + dz
      );
    }
  }

  addBox(
    width - 0.2,
    0.3,
    0.05,
    M.woodDark,
    x,
    baseY + 0.48,
    z + 0.36
  );
}

function makeChair(x, baseY, z, color = 0x536c82) {
  const material = mat(color);

  seatSpots.push({ floor: buildingFloor, x, z, baseY });

  addBox(
    0.62,
    0.12,
    0.58,
    material,
    x,
    baseY + 0.48,
    z,
    true
  );

  addBox(
    0.62,
    0.58,
    0.11,
    material,
    x,
    baseY + 0.81,
    z + 0.23
  );

  for (const dx of [-0.23, 0.23]) {
    for (const dz of [-0.20, 0.20]) {
      addBox(
        0.05,
        0.45,
        0.05,
        M.metal,
        x + dx,
        baseY + 0.23,
        z + dz
      );
    }
  }
}

function makeComputer(x, baseY, z, options = {}) {
  const width = options.width || 1.65;

  makeDesk(x, baseY, z, width);

  addBox(
    0.95,
    0.65,
    0.1,
    M.black,
    x,
    baseY + 1.28,
    z - 0.2
  );

  addBox(
    0.82,
    0.51,
    0.025,
    M.screen,
    x,
    baseY + 1.29,
    z - 0.14
  );

  addBox(
    0.12,
    0.25,
    0.12,
    M.metal,
    x,
    baseY + 0.91,
    z - 0.2
  );

  addBox(
    0.42,
    0.05,
    0.28,
    M.metal,
    x,
    baseY + 0.85,
    z - 0.2
  );

  addBox(
    0.62,
    0.035,
    0.22,
    M.black,
    x,
    baseY + 0.91,
    z + 0.18
  );

  addBox(
    0.11,
    0.035,
    0.16,
    M.metal,
    x + 0.48,
    baseY + 0.91,
    z + 0.17
  );

  addBox(
    0.30,
    0.55,
    0.48,
    M.black,
    x + width / 2 - 0.19,
    baseY + 0.29,
    z - 0.12,
    true
  );

  addBox(
    0.035,
    0.035,
    0.025,
    M.green,
    x + width / 2 - 0.19,
    baseY + 0.48,
    z - 0.37
  );

  makeChair(x, baseY, z + 1.12);
}

function makeCabinet(x, baseY, z) {
  addBox(
    1.15,
    1.75,
    0.48,
    M.woodDark,
    x,
    baseY + 0.875,
    z,
    true
  );

  addBox(
    1.05,
    1.6,
    0.05,
    M.woodLight,
    x,
    baseY + 0.875,
    z - 0.265
  );

  for (const y of [0.4, 0.9, 1.4]) {
    addBox(
      0.98,
      0.035,
      0.07,
      M.woodDark,
      x,
      baseY + y,
      z - 0.30
    );
  }

  addBox(
    0.055,
    0.08,
    0.08,
    M.metal,
    x + 0.34,
    baseY + 0.9,
    z - 0.36
  );
}

function makeBookshelf(x, baseY, z) {
  addBox(
    1.35,
    2.0,
    0.42,
    M.woodDark,
    x,
    baseY + 1,
    z,
    true
  );

  for (const y of [0.55, 1.05, 1.55]) {
    addBox(
      1.32,
      0.07,
      0.46,
      M.woodLight,
      x,
      baseY + y,
      z
    );
  }

  const colors = [
    0x8c5447,
    0x536d79,
    0x9c8159,
    0x607b61,
    0x806b8c
  ];

  for (let shelf = 0; shelf < 3; shelf++) {
    for (let i = 0; i < 5; i++) {
      addBox(
        0.15,
        0.36,
        0.27,
        mat(colors[(i + shelf) % colors.length]),
        x - 0.48 + i * 0.24,
        baseY + 0.76 + shelf * 0.5,
        z - 0.04
      );
    }
  }
}

function makePrinter(x, baseY, z) {
  makeDesk(x, baseY, z, 1.8);

  addBox(
    1.1,
    0.62,
    0.8,
    M.white,
    x,
    baseY + 1.2,
    z
  );

  addBox(
    0.75,
    0.05,
    0.4,
    M.black,
    x,
    baseY + 1.54,
    z - 0.08
  );

  addBox(
    0.65,
    0.035,
    0.38,
    M.paper,
    x,
    baseY + 1.58,
    z + 0.15
  );
}

function makeWireBundle(x, baseY, z) {
  const wireColors = [
    0xe34b4b,
    0x438bd4,
    0xe5bd38,
    0x39a66b
  ];

  wireColors.forEach((color, index) => {
    const offset = index * 0.045;

    const points = [
      new THREE.Vector3(
        x - 0.58,
        baseY + 0.94,
        z + 0.18 + offset
      ),

      new THREE.Vector3(
        x - 0.30,
        baseY + 1.01,
        z + 0.34 + offset
      ),

      new THREE.Vector3(
        x + 0.25,
        baseY + 1.01,
        z + 0.34 + offset
      ),

      new THREE.Vector3(
        x + 0.58,
        baseY + 0.94,
        z + 0.18 + offset
      )
    ];

    const curve = new THREE.CatmullRomCurve3(points);

    const geometry = new THREE.TubeGeometry(
      curve,
      24,
      0.018,
      8,
      false
    );

    const cable = new THREE.Mesh(
      geometry,
      mat(color, 0.45)
    );

    cable.castShadow = true;

    scene.add(cable);

    // Cable connectors.
    const connectorMaterial = mat(0x30343a);

    addBox(
      0.12,
      0.065,
      0.09,
      connectorMaterial,
      x - 0.58,
      baseY + 0.94,
      z + 0.18 + offset
    );

    addBox(
      0.12,
      0.065,
      0.09,
      connectorMaterial,
      x + 0.58,
      baseY + 0.94,
      z + 0.18 + offset
    );
  });
}

function makeWhiteboard(x, baseY, z, rotation = 0) {
  // Keep boards mounted close to the wall instead of floating in the room.
  if (z < -12) z = -14.83;
  const board = addBox(
    2.7,
    1.35,
    0.12,
    M.white,
    x,
    baseY + 2.15,
    z
  );

  board.rotation.y = rotation;

  const writing = addBox(
    2.5,
    1.16,
    0.025,
    M.paper,
    x,
    baseY + 2.15,
    z - 0.075
  );

  writing.rotation.y = rotation;
}

function makePlant(x, baseY, z) {
  addBox(
    0.55,
    0.45,
    0.55,
    M.woodDark,
    x,
    baseY + 0.22,
    z,
    true
  );

  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 10),
      M.plant
    );

    leaf.position.set(
      x + Math.sin(i * 1.25) * 0.18,
      baseY + 0.8 + (i % 2) * 0.12,
      z + Math.cos(i * 1.25) * 0.18
    );

    leaf.scale.set(0.65, 1.4, 0.65);
    leaf.castShadow = true;

    scene.add(leaf);
  }
}

function makePaper(x, baseY, z, rotation = 0) {
  const paper = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.012, 0.58),
    M.paper
  );

  paper.position.set(x, baseY + 0.90, z);
  paper.rotation.y = rotation;
  paper.rotation.x = -0.015;

  paper.castShadow = true;
  scene.add(paper);

  for (let i = 0; i < 4; i++) {
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.30, 0.006, 0.009),
      M.wallDark
    );

    line.position.set(
      x,
      baseY + 0.911,
      z - 0.16 + i * 0.075
    );

    line.rotation.y = rotation;
    scene.add(line);
  }
}

function makeFloorPaper(x, baseY, z, rotation = 0) {
  const paper = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.012, 0.58),
    M.paper
  );

  paper.position.set(x, baseY + 0.015, z);
  paper.rotation.y = rotation;

  scene.add(paper);
}

function makeFolder(x, baseY, z) {
  addBox(
    0.55,
    0.045,
    0.68,
    mat(0x9b7850),
    x,
    baseY + 0.91,
    z
  );

  addBox(
    0.25,
    0.035,
    0.08,
    mat(0xc2a16b),
    x - 0.12,
    baseY + 0.95,
    z - 0.30
  );
}

function makeOfficeSupplies(x, baseY, z) {
  addBox(
    0.20,
    0.22,
    0.20,
    M.black,
    x,
    baseY + 1.00,
    z
  );

  const penColors = [
    0xd94848,
    0x316cba,
    0x328a58
  ];

  penColors.forEach((color, i) => {
    addBox(
      0.035,
      0.30,
      0.035,
      mat(color),
      x - 0.06 + i * 0.06,
      baseY + 1.24,
      z
    );
  });
}


function updateTeacherHitEffect(delta) {

  if (teacherHitCooldown > 0) {
    teacherHitCooldown -= delta;
  }

  if (teacherHitEffectTime > 0) {
    teacherHitEffectTime -= delta;
  }

  if (teacherShakeTime > 0) {
    teacherShakeTime -= delta;

    const intensity = 0.055 * (
      teacherShakeTime / 0.25
    );

    camera.position.x +=
      (Math.random() - 0.5) * intensity;

    camera.position.y +=
      (Math.random() - 0.5) * intensity;

  }

  const flash = $("teacher-hit-flash");

  if (flash) {
    flash.style.opacity =
      teacherHitEffectTime > 0 ? "1" : "0";
  }
}


function triggerTeacherCatch(teacher) {

  if (teacherHitCooldown > 0) return;

  teacherHitCooldown = 2;

  // TIME PENALTY
  timeLeft = Math.max(0, timeLeft - 2);
  updateHUD();

  // SCREEN EFFECT
  teacherHitEffectTime = 0.35;
  teacherShakeTime = 0.25;

  // POKE ANIMATION TRIGGER
  teacher.pokeTime = 0.25;

  showToast("TEACHER CAUGHT YOU! -2 SECONDS");

  if (timeLeft <= 0) {
    finishGame(false);
  }
}

function makeNPC(
  x,
  baseY,
  z,
  shirtColor = 0x536c82,
  appearance = {}
) {
  const npc = new THREE.Group();

  const shirtMat = mat(shirtColor);
  const pantsMat = mat(0x303747);
  const shoeMat = mat(0x252525);
  const skinMat = M.skin;
  const hairMat = M.hair;
  const eyeWhiteMat = mat(0xffffff);
  const pupilMat = mat(0x211b19);
  const browMat = mat(0x30251f);
  const mouthMat = mat(0x713f3b);

  // BODY
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.27, 0.34, 0.9, 20),
    shirtMat
  );
  body.position.y = 0.98;
  body.castShadow = true;
  npc.add(body);

  // NECK
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.09, 0.18, 12),
    skinMat
  );
  neck.position.y = 1.47;
  npc.add(neck);

  // HEAD
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.235, 24, 24),
    skinMat
  );
  head.position.set(0, 1.64, 0);
  npc.add(head);

  // EARS
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 14, 14),
      skinMat
    );
    ear.position.set(side * 0.225, 1.63, 0);
    ear.scale.set(0.75, 1, 0.65);
    npc.add(ear);
  }

  // EYES
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.052, 16, 16),
      eyeWhiteMat
    );
    eye.position.set(side * 0.085, 1.665, 0.205);
    eye.scale.set(1, 0.82, 0.45);
    npc.add(eye);

    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 12, 12),
      pupilMat
    );
    pupil.position.set(side * 0.085, 1.66, 0.229);
    npc.add(pupil);

    const eyebrow = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.018, 0.025),
      browMat
    );
    eyebrow.position.set(side * 0.085, 1.735, 0.205);
    eyebrow.rotation.z = side * -0.08;
    npc.add(eyebrow);
  }

  // NOSE
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 12),
    skinMat
  );
  nose.position.set(0, 1.605, 0.235);
  nose.scale.set(0.8, 1.1, 0.75);
  npc.add(nose);

  // MOUTH
  const mouth = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 16, 12),
    mouthMat
  );
  mouth.position.set(0, 1.535, 0.215);
  mouth.scale.set(1.1, 0.25, 0.25);
  npc.add(mouth);

  // HAIR CAP
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(
      0.245, 24, 18, 0, Math.PI * 2, 0, Math.PI / 2
    ),
    hairMat
  );
  hair.position.set(0, 1.72, -0.005);
  npc.add(hair);

  // SIDE HAIR
  if (appearance.longHair || appearance.wavyHair || appearance.tiedBack) {
    for (const side of [-1, 1]) {
      const strand = new THREE.Mesh(
        new THREE.BoxGeometry(0.10, 0.48, 0.16),
        hairMat
      );
      strand.position.set(side * 0.19, 1.43, -0.015);
      npc.add(strand);
    }

    const backHair = new THREE.Mesh(
      new THREE.BoxGeometry(0.40, 0.58, 0.17),
      hairMat
    );
    backHair.position.set(0, 1.40, -0.13);
    npc.add(backHair);
  }

  // BANGS
  if (appearance.bangs) {
    const bangs = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.13, 0.12),
      hairMat
    );
    bangs.position.set(0, 1.68, 0.19);
    npc.add(bangs);
  }

  // CURLY HAIR
  if (appearance.curlyHair) {
    const curlPositions = [
      [-0.18, 1.78, 0.02],
      [-0.09, 1.84, 0.04],
      [0, 1.86, 0.04],
      [0.09, 1.84, 0.04],
      [0.18, 1.78, 0.02],
      [-0.20, 1.68, 0.08],
      [0.20, 1.68, 0.08],
      [-0.12, 1.75, 0.16],
      [0, 1.79, 0.19],
      [0.12, 1.75, 0.16]
    ];

    for (const p of curlPositions) {
      const curl = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 12, 12),
        hairMat
      );
      curl.position.set(p[0], p[1], p[2]);
      npc.add(curl);
    }
  }

  // TIED-BACK HAIR
  if (appearance.tiedBack) {
    const bun = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 14, 14),
      hairMat
    );
    bun.position.set(0, 1.68, -0.24);
    npc.add(bun);
  }

  // WAVY HAIR
  if (appearance.wavyHair) {
    for (const side of [-1, 1]) {
      const wave = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.58, 0.14),
        hairMat
      );
      wave.position.set(side * 0.20, 1.40, 0.02);
      wave.rotation.z = side * 0.08;
      npc.add(wave);
    }
  }

  // GLASSES
  if (appearance.glasses) {
    const glassesMat = mat(0x242424);

    for (const side of [-1, 1]) {
      const lens = new THREE.Mesh(
        new THREE.TorusGeometry(0.058, 0.009, 8, 20),
        glassesMat
      );
      lens.position.set(side * 0.085, 1.665, 0.235);
      npc.add(lens);
    }

    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.012, 0.018),
      glassesMat
    );
    bridge.position.set(0, 1.665, 0.235);
    npc.add(bridge);
  }

  // MOLES
  function createMole(side, position) {
    const mole = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 10, 10),
      mat(0x30201a)
    );

    mole.position.set(
      side === "left" ? -0.14 : 0.14,
      position === "forehead" ? 1.77 : 1.57,
      0.22
    );

    npc.add(mole);
  }

  if (appearance.mole) {
    createMole(
      appearance.moleSide || "left",
      appearance.molePosition || "cheek"
    );
  }

  if (appearance.moles) {
    appearance.moles.forEach(mole => {
      createMole(mole.side, mole.position);
    });
  }

  // HAIR CLIP
  if (appearance.hairClip) {
    const clip = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.025, 0.035),
      mat(0xd5b46a, 0.35, { metalness: 0.45 })
    );
    clip.position.set(0.17, 1.76, 0.12);
    npc.add(clip);
  }

  // ARMS
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.075, 0.32, 4, 10),
      shirtMat
    );
    arm.position.set(side * 0.31, 1.02, 0);
    arm.rotation.z = side * -0.10;
    npc.add(arm);

    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 12, 12),
      skinMat
    );
    hand.position.set(side * 0.34, 0.78, 0.015);
    npc.add(hand);
  }

  // LEGS
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.085, 0.34, 4, 10),
      pantsMat
    );
    leg.position.set(side * 0.13, 0.36, 0);
    npc.add(leg);

    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.17, 0.10, 0.27),
      shoeMat
    );
    shoe.position.set(side * 0.13, 0.08, 0.055);
    npc.add(shoe);
  }

  npc.position.set(x, baseY, z);
  npc.rotation.y = appearance.rotationY ?? 0;
  scene.add(npc);

if (!appearance.noCollider) {
  addCollider(x, z, 0.65, 0.65);
}

return npc;
}

function makeAmbientNPC(
  x,
  baseY,
  z,
  shirtColor = 0x536c82,
  options = {}
) {
  const npc = new THREE.Group();

  // BODY
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.31, 0.85, 12),
    mat(shirtColor)
  );
  body.position.y = 0.98;
  body.castShadow = true;
  npc.add(body);

  // HEAD
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 14, 14),
    M.skin
  );
  head.position.y = 1.58;
  npc.add(head);

  // HAIR
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(
      0.23, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2
    ),
    M.hair
  );
  hair.position.y = 1.68;
  npc.add(hair);

    // FACE — EYES, EYEBROWS, NOSE, AND MOUTH
  const eyeWhite = mat(0xffffff);
  const pupilMat = mat(0x211b19);
  const browMat = mat(0x30251f);
  const mouthMat = mat(0x713f3b);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 12),
      eyeWhite
    );

    eye.position.set(side * 0.078, 1.59, 0.195);
    eye.scale.set(1, 0.85, 0.45);
    npc.add(eye);

    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 10, 10),
      pupilMat
    );

    pupil.position.set(side * 0.078, 1.585, 0.216);
    npc.add(pupil);

    const brow = new THREE.Mesh(
      new THREE.BoxGeometry(0.085, 0.014, 0.02),
      browMat
    );

    brow.position.set(side * 0.078, 1.65, 0.19);
    npc.add(brow);

    const ear = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 10, 10),
      M.skin
    );

    ear.position.set(side * 0.215, 1.58, 0);
    npc.add(ear);
  }

  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 10, 10),
    M.skin
  );

  nose.position.set(0, 1.55, 0.215);
  npc.add(nose);

  const mouth = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 10),
    mouthMat
  );

  mouth.position.set(0, 1.49, 0.195);
  mouth.scale.set(1.1, 0.25, 0.3);
  npc.add(mouth);

  // LEFT LEG
  const leftLeg = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.42, 0.16),
    mat(0x303747)
  );
  leftLeg.position.set(-0.13, 0.38, 0);
  npc.add(leftLeg);

  // RIGHT LEG
  const rightLeg = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.42, 0.16),
    mat(0x303747)
  );
  rightLeg.position.set(0.13, 0.38, 0);
  npc.add(rightLeg);

  // LEFT ARM
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.29, 1.30, 0);

  const leftArmMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.48, 0.14),
    mat(shirtColor)
  );
  leftArmMesh.position.y = -0.22;
  leftArm.add(leftArmMesh);
  npc.add(leftArm);

  // RIGHT ARM
  const rightArm = new THREE.Group();
  rightArm.position.set(0.29, 1.30, 0);

  const rightArmMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.48, 0.14),
    mat(shirtColor)
  );
  rightArmMesh.position.y = -0.22;
  rightArm.add(rightArmMesh);
  npc.add(rightArm);

  // BACKPACK
  if (options.backpack) {
    const bag = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.42, 0.16),
      mat(0x343d50)
    );
    bag.position.set(0, 0.98, -0.27);
    npc.add(bag);
  }

  // BOOK
  if (options.book) {
    const book = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.28, 0.035),
      mat(0x9b7657)
    );
    book.position.set(0.28, 1.12, 0.12);
    npc.add(book);
  }

  npc.position.set(x, baseY, z);
  npc.rotation.y = options.rotationY ?? 0;
  scene.add(npc);

  ambientNPCs.push({
    group: npc,
    body: body,
    head: head,
    leftLeg: leftLeg,
    rightLeg: rightLeg,
    leftArm: leftArm,
    rightArm: rightArm,
    walking: options.walking || false,
    talking: options.talking || false,
    direction: options.direction || 1,
    speed: options.speed || 0.65,
    minZ: options.minZ ?? z - 3,
    maxZ: options.maxZ ?? z + 3,
    baseY: baseY,
    baseRotationY: npc.rotation.y,
    idleTime: Math.random() * Math.PI * 2,
    pauseTimer: 0,
    pauseDuration: options.pauseDuration ?? 1.2,
    animationSpeed: 0.75 + Math.random() * 0.6,

    // RANDOM IDLE ACTION
    idleActionTimer: 2 + Math.random() * 4,
    idleAction: 0,
    idleActionDuration: 0,
    idleHeadOffset: 0
  });

  return npc;
}


function updateExamStudents(delta) {

  if (
    !gameStarted ||
    gamePaused ||
    gameFinished ||
    currentFloor !== 2
  ) return;

  const elapsed = performance.now() / 1000;

  for (const student of examStudents) {

    const t = elapsed * student.speed + student.phase;

    // WRITING ARM MOVEMENT
    student.arms[0].rotation.x =
      Math.sin(t * 3) * 0.08;

    student.arms[1].rotation.x =
      Math.sin(t * 3 + 0.5) * 0.08;

    // PENCIL MOVEMENT
    student.pencil.rotation.z =
      Math.sin(t * 3) * 0.12;

    student.pencil.position.y =
      0.91 + Math.sin(t * 3) * 0.012;

    // OCCASIONAL HEAD MOVEMENT
    student.head.rotation.x =
      Math.sin(t * 0.7) * 0.045;

    student.head.rotation.y =
      Math.sin(t * 0.45) * 0.035;
  }
}


function updateAmbientNPCs(delta) {
  for (const npc of ambientNPCs) {
    npc.idleTime += delta;

    const time = npc.idleTime;
    const variation = npc.animationSpeed || 1;

    // WALKING NPCs
    if (npc.walking) {
      if (npc.pauseTimer > 0) {
        npc.pauseTimer -= delta;

        npc.leftLeg.rotation.x = 0;
        npc.rightLeg.rotation.x = 0;
        npc.leftArm.rotation.x = 0;
        npc.rightArm.rotation.x = 0;

        continue;
      }

      npc.group.position.z +=
        npc.direction * npc.speed * delta;

      if (npc.group.position.z >= npc.maxZ) {
        npc.group.position.z = npc.maxZ;
        npc.direction = -1;
        npc.pauseTimer = npc.pauseDuration;
      }

      if (npc.group.position.z <= npc.minZ) {
        npc.group.position.z = npc.minZ;
        npc.direction = 1;
        npc.pauseTimer = npc.pauseDuration;
      }

      npc.group.rotation.y =
        npc.direction === 1 ? 0 : Math.PI;

      const walkCycle = time * 7 * variation;

      npc.leftLeg.rotation.x =
        Math.sin(walkCycle) * 0.45;

      npc.rightLeg.rotation.x =
        Math.sin(walkCycle + Math.PI) * 0.45;

      npc.leftArm.rotation.x =
        Math.sin(walkCycle + Math.PI) * 0.4;

      npc.rightArm.rotation.x =
        Math.sin(walkCycle) * 0.4;

      npc.group.position.y =
        npc.baseY +
        Math.abs(Math.sin(walkCycle)) * 0.045;

      continue;
    }

    // RANDOM IDLE ACTION TIMER
    npc.idleActionTimer -= delta;

    if (npc.idleActionTimer <= 0) {
      npc.idleAction = Math.random() < 0.5 ? -1 : 1;
      npc.idleActionDuration = 0.8 + Math.random() * 1.2;
      npc.idleActionTimer = 3 + Math.random() * 5;
    }

    if (npc.idleActionDuration > 0) {
      npc.idleActionDuration -= delta;
    } else {
      npc.idleAction = 0;
    }

    npc.idleHeadOffset +=
      (npc.idleAction * 0.18 - npc.idleHeadOffset) *
      Math.min(delta * 3, 1);

    // SITTING NPCs
    if (npc.sitting) {
      npc.body.rotation.z =
        Math.sin(time * 1.5 * variation) * 0.025;

      npc.head.rotation.y =
        Math.sin(time * 1.2 * variation) * 0.12 +
        npc.idleHeadOffset;

      npc.head.rotation.x =
        Math.sin(time * 0.9 * variation) * 0.035;

      npc.leftArm.rotation.x =
        Math.sin(time * 1.4 * variation) * 0.08;

      npc.rightArm.rotation.x =
        Math.sin(time * 1.4 * variation + Math.PI) * 0.08;

      npc.group.rotation.y =
        npc.baseRotationY +
        Math.sin(time * 0.7 * variation) * 0.025;

      continue;
    }

    // STANDING NPCs
    npc.group.position.y =
      npc.baseY +
      Math.sin(time * 1.5 * variation) * 0.025;

    npc.head.rotation.y =
      npc.idleHeadOffset +
      Math.sin(time * 1.2 * variation) * 0.08;

    npc.head.rotation.x =
      Math.sin(time * 0.9 * variation) * 0.025;

    npc.leftArm.rotation.x =
      Math.sin(time * 1.5 * variation) * 0.06;

    npc.rightArm.rotation.x =
      Math.sin(time * 1.5 * variation + Math.PI) * 0.06;

    // TALKING NPCs
    if (npc.talking) {
      npc.body.rotation.z =
        Math.sin(time * 3 * variation) * 0.045;

      npc.head.rotation.y +=
        Math.sin(time * 2 * variation) * 0.12;

      npc.leftArm.rotation.x =
        Math.sin(time * 3 * variation) * 0.22;

      npc.rightArm.rotation.x =
        Math.sin(time * 3 * variation + Math.PI) * 0.22;
    }

    // SLIGHT BODY ROTATION
    npc.group.rotation.y =
      npc.baseRotationY +
      Math.sin(time * 0.8 * variation) * 0.04;
  }
}

function makeSittingAmbientNPC(
  x,
  baseY,
  z,
  shirtColor = 0x547b83,
  rotationY = 0
) {
  const group = new THREE.Group();

  // BENCH SEAT
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.12, 0.42),
    mat(0x76563e)
  );

  seat.position.y = 0.55;
  group.add(seat);

  // BENCH BACKREST
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.65, 0.12),
    mat(0x76563e)
  );

  back.position.set(0, 0.88, -0.2);
  group.add(back);

  // BENCH LEGS
  for (const side of [-0.48, 0.48]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.55, 0.1),
      mat(0x493c30)
    );

    leg.position.set(side, 0.27, 0);
    group.add(leg);
  }

  // BODY
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.3, 0.72, 12),
    mat(shirtColor)
  );

  body.position.set(0, 1.0, -0.02);
  group.add(body);

  // HEAD
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 14, 14),
    M.skin
  );

  head.position.set(0, 1.52, 0.04);
  group.add(head);

  // HAIR
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(
      0.23,
      14,
      10,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2
    ),
    M.hair
  );

  hair.position.set(0, 1.62, 0.04);
  group.add(hair);

  // LEFT ARM
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.27, 1.25, 0.02);

  const leftArmMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.4, 0.14),
    mat(shirtColor)
  );

  leftArmMesh.position.y = -0.18;
  leftArm.add(leftArmMesh);
  group.add(leftArm);

  // RIGHT ARM
  const rightArm = new THREE.Group();
  rightArm.position.set(0.27, 1.25, 0.02);

  const rightArmMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.4, 0.14),
    mat(shirtColor)
  );

  rightArmMesh.position.y = -0.18;
  rightArm.add(rightArmMesh);
  group.add(rightArm);

  // LEGS
  for (const side of [-0.13, 0.13]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.48, 0.16),
      mat(0x303747)
    );

    leg.position.set(side, 0.48, 0.22);
    leg.rotation.x = -0.35;
    group.add(leg);
  }

  group.position.set(x, baseY, z);
  group.rotation.y = rotationY;

  scene.add(group);

  ambientNPCs.push({
    group: group,
    body: body,
    head: head,
    leftArm: leftArm,
    rightArm: rightArm,
    walking: false,
    sitting: true,
    baseY: baseY,
    baseRotationY: rotationY,
    idleTime: Math.random() * Math.PI * 2,
    animationSpeed: 0.75 + Math.random() * 0.6,

    // RANDOM IDLE ACTION
    idleActionTimer: 2 + Math.random() * 4,
    idleAction: 0,
    idleActionDuration: 0,
    idleHeadOffset: 0
  });

  return group;
}

function buildAmbientNPCs(floor, baseY) {

  // THIRD FLOOR
  if (floor === 3) {
    makeAmbientNPC(-1.5, baseY, -11, 0x547b83, {
      walking: true,
      speed: 0.55,
      minZ: -14,
      maxZ: -7,
      backpack: true
    });

    makeAmbientNPC(1.5, baseY, 2, 0x826a91, {
      walking: true,
      speed: 0.7,
      minZ: -1,
      maxZ: 6,
      book: true
    });

    makeAmbientNPC(-1.2, baseY, -3, 0x9b7657);
    makeAmbientNPC(-0.5, baseY, -3.5, 0x55745f);
  }

  // SECOND FLOOR
  if (floor === 2) {

    // WALKING STUDENT — LEFT SIDE
    makeAmbientNPC(-1.5, baseY, -12, 0x98765b, {
      walking: true,
      speed: 0.6,
      minZ: -14,
      maxZ: -6,
      backpack: true
    });

    // WALKING STUDENT — RIGHT SIDE
    makeAmbientNPC(1.5, baseY, 1, 0x547b83, {
      walking: true,
      speed: 0.75,
      minZ: -3,
      maxZ: 7,
      book: true
    });

// WALKING STUDENT — END OF HALLWAY
makeAmbientNPC(0, baseY, 2, 0x826a91, {
  walking: true,
  speed: 0.45,
  minZ: 0,
  maxZ: 4,
  backpack: true
});

    // STUDENTS TALKING
    makeAmbientNPC(-1.5, baseY, -1.8, 0x55745f, {
      rotationY: Math.PI / 2,
      talking: true
    });

    makeAmbientNPC(-1.5, baseY, -3.1, 0xb97849, {
      rotationY: -Math.PI / 2,
      talking: true
    });

// STUDENTS SITTING IN THE HALLWAY

// BLUE SHIRT — ROTATE RIGHT
makeSittingAmbientNPC(
  -3.2,
  baseY,
  5,
  0x547b83,
  Math.PI / 2
);

// PURPLE SHIRT — ROTATE LEFT
makeSittingAmbientNPC(
  3.2,
  baseY,
  5,
  0x826a91,
  -Math.PI / 2
);
  }

  // FIRST FLOOR
  if (floor === 1) {
    makeAmbientNPC(-1.5, baseY, -10, 0x55745f, {
      walking: true,
      speed: 0.7,
      minZ: -14,
      maxZ: -5,
      backpack: true
    });

    makeAmbientNPC(1.5, baseY, 2, 0x98765b, {
      walking: true,
      speed: 0.6,
      minZ: -3,
      maxZ: 8,
      book: true
    });

    makeAmbientNPC(-1.2, baseY, -1, 0x826a91);
    makeAmbientNPC(-0.5, baseY, -1.5, 0x547b83);
    makeAmbientNPC(1.2, baseY, 10, 0xb97849);
  }
}


// ============================================================
// DOORS
// ============================================================

function makeDoorHandle(doorGroup, x, y, z) {
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.12, 12),
    M.metal
  );

  stem.rotation.z = Math.PI / 2;
  stem.position.set(x, y, z);

  doorGroup.add(stem);

  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 16, 12),
    mat(0xc4a45e, 0.25, { metalness: 0.8 })
  );

  knob.position.set(x + (x > 0 ? 0.08 : -0.08), y, z);
  doorGroup.add(knob);
}

function createDoor(floor, side, z, label) {
  const baseY = FLOOR_Y[floor];

  const wallX = side * 3.9;
  const hingeZ = z - 0.92;

  const doorGroup = new THREE.Group();

  doorGroup.position.set(wallX, baseY, hingeZ);
  scene.add(doorGroup);

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 2.35, 1.82),
    M.wood
  );

  panel.position.set(0, 1.175, 0.91);
  panel.castShadow = true;

  doorGroup.add(panel);

  const inset = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 1.88, 1.36),
    M.woodLight
  );

  inset.position.set(side * 0.075, 1.17, 0.91);
  doorGroup.add(inset);

  for (const y of [0.45, 1.82]) {
    const detail = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.48, 1.18),
      M.wood
    );

    detail.position.set(side * 0.10, y, 0.91);
    doorGroup.add(detail);
  }

  makeDoorHandle(
    doorGroup,
    side * 0.13,
    1.05,
    1.62
  );

  makeDoorHandle(
    doorGroup,
    -side * 0.13,
    1.05,
    1.62
  );

  addBox(
    0.18,
    2.45,
    0.14,
    M.woodLight,
    wallX,
    baseY + 1.225,
    z - 1.0
  );

  addBox(
    0.18,
    2.45,
    0.14,
    M.woodLight,
    wallX,
    baseY + 1.225,
    z + 1.0
  );

  addBox(
    0.18,
    0.14,
    2.1,
    M.woodLight,
    wallX,
    baseY + 2.47,
    z
  );

  const door = {
    floor,
    x: wallX,
    z,
    label,
    group: doorGroup,
    open: false,
    angle: 0,
    target: 0
  };

  doors.push(door);

  interactables.push({
    floor,
    x: wallX,
    z,
    title: label,
    description: "A classroom door. Press E to open or close it.",
id: `door-${floor}-${side}-${z}`,
    kind: "door",
    door
  });
}

function toggleDoor(door) {
  if (!door) return;

  door.open = !door.open;

  door.target = door.open
    ? (door.x < 0 ? Math.PI / 2 : -Math.PI / 2)
    : 0;

  showToast(
    door.open
      ? "Door opened. You can enter the room now."
      : "Door closed."
  );
}

// ============================================================
// STAIRCASE
// ============================================================

function buildStairs(floor, baseY) {
  if (floor === 1) return;

  const width = 2.75;
  const stepCount = 16;
  const totalDrop = FLOOR_HEIGHT;

  const rise = totalDrop / stepCount;
  const depth = 0.39;

  const startZ = 7.8;
  const lowerY = baseY - FLOOR_HEIGHT;

  addBox(
    3.35,
    0.22,
    1.65,
    M.tile,
    0,
    baseY - 0.11,
    7.0
  );

  for (let i = 0; i < stepCount; i++) {
    const treadTop = baseY - (i + 1) * rise;
    const stepZ = startZ + i * depth;

    addBox(
      width,
      0.16,
      depth,
      M.tile,
      0,
      treadTop - 0.08,
      stepZ
    );

    addBox(
      width,
      rise,
      0.075,
      M.tile,
      0,
      baseY - (i + 0.5) * rise,
      stepZ - depth / 2 + 0.035
    );

    addBox(
      width,
      0.045,
      0.075,
      M.woodLight,
      0,
      treadTop + 0.012,
      stepZ - depth / 2 + 0.035
    );
  }

  addBox(
    3.35,
    0.22,
    1.65,
    M.tile,
    0,
    lowerY - 0.11,
    14.0
  );

  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.12, 6.35),
      M.woodDark
    );

    rail.position.set(
      side * 1.48,
      baseY - 1.95,
      10.85
    );

    rail.rotation.x = 0.56;
    rail.castShadow = true;

    scene.add(rail);

    for (let i = 0; i < 9; i++) {
      const t = i / 8;

      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.065, 0.78, 0.065),
        M.metal
      );

      post.position.set(
        side * 1.48,
        baseY - 0.40 - t * 3.25,
        8.0 + t * 5.7
      );

      post.castShadow = true;
      scene.add(post);
    }
  }

  for (const side of [-1, 1]) {
    addBox(
      0.12,
      0.9,
      1.2,
      M.woodDark,
      side * 1.58,
      lowerY + 0.45,
      14.0
    );
  }
}

// ============================================================
// TASKS AND FLOOR INFORMATION
// ============================================================

const roomLabels = {
  3: {
    left: [
      "COMPUTER LAB 301",
      "CLASSROOM 302",
      "FACULTY ROOM 303"
    ],
    right: [
      "CLASSROOM 304",
      "STUDY ROOM 305",
      "FACULTY ROOM 306"
    ]
  },

  2: {
    left: [
      "CLASSROOM 201",
      "GROUP STUDY ROOM 202",
      "FACULTY ROOM 203"
    ],
    right: [
      "CLASSROOM 204",
      "GROUP STUDY ROOM 205",
      "FACULTY ROOM 206"
    ]
  },

  1: {
    left: [
      "PRINTING ROOM 101",
      "LOBBY 102",
      "SUBMISSION OFFICE 103"
    ],
    right: [
      "PRINTING ROOM 104",
      "LOBBY 105",
      "SUBMISSION OFFICE 106"
    ]
  }
};
const floorInfo = {
  3: {
    name: "THIRD FLOOR",
    description: "Repair the computer, restore the network, and secure your thesis files.",

    tasks: [
      ["Repair the frozen computer", "computer"],
      ["Restore the internet connection", "router"],
      ["Run a system and file check", "diagnostic"]
    ]
  },

2: {
  name: "SECOND FLOOR",
  description: "Find your four groupmates and collect their contributions for thesis printing.",

  tasks: [
    ["Get Kristine's contribution", "kristine"],
    ["Get Enir's contribution", "enir"],
    ["Get Jio's contribution", "jio"],
    ["Get Rovelin's contribution", "rovelin"]
  ]
},

  1: {
    name: "FIRST FLOOR",
    description: "Print, bind, and submit your completed thesis.",

    tasks: [
      ["Prepare and print the thesis", "printer"],
      ["Arrange and bind the pages", "binding"],
      ["Submit the final thesis", "submission"]
    ]
  }
};

function addInteractable(
  floor,
  x,
  z,
  title,
  description,
  id,
  kind
) {
  interactables.push({
    floor,
    x,
    z,
    title,
    description,
    id,
    kind
  });
}

// ============================================================
// MOVING TEACHERS
// ============================================================

function registerMovingTeacher(id, group, interaction) {
  movingTeachers.push({
    id,
    group,
    interaction,
    speed: 1.8,
    stopDistance: 1.75,
    triggerDistance: 9,
    stopped: false,
    contactCooldown: 0
  });
}


function stopTeacherApproach(id) {
  const teacher = movingTeachers.find(
    item => item.id === id
  );

  if (teacher) {
    teacher.stopped = true;
  }
}

function removeCompletedTeacher(id) {
  const teacherIndex = movingTeachers.findIndex(
    item => item.id === id
  );

  if (teacherIndex === -1) return;

  const teacher = movingTeachers[teacherIndex];

  // Remove teacher's 3D model
  scene.remove(teacher.group);

  // Remove teacher from moving teachers list
  movingTeachers.splice(teacherIndex, 1);

  // Remove teacher's interaction
  const interactionIndex = interactables.indexOf(
    teacher.interaction
  );

  if (interactionIndex !== -1) {
    interactables.splice(interactionIndex, 1);
  }
}

function showTeacherHitEffect() {

  let effect = document.getElementById("teacher-hit-effect");

  if (!effect) {

    effect = document.createElement("div");
    effect.id = "teacher-hit-effect";

    document.body.appendChild(effect);
  }

  effect.classList.remove("hit-active");

  // Restart animation
  void effect.offsetWidth;

  effect.classList.add("hit-active");
}



function updateMovingTeachers(delta) {

  if (
    !gameStarted ||
    gamePaused ||
    gameFinished ||
    currentFloor !== 2 ||
    activeInteraction
  ) return;

  // WAIT AFTER THE PREVIOUS FAVOR
  if (teacherChaseCooldown > 0) {
    teacherChaseCooldown -= delta;

    if (teacherChaseCooldown <= 0) {
      teacherChaseCooldown = 0;

      const nextTeacher = movingTeachers.find(
        teacher => teacher.id === nextTeacherToChase
      );

      if (nextTeacher) {
        nextTeacher.stopped = false;
      }
    }

    return;
  }

  // ONLY THE ASSIGNED TEACHER CAN CHASE
  const teacher = movingTeachers.find(
    item =>
      item.id === nextTeacherToChase &&
      !item.stopped
  );

  if (!teacher) return;

  const group = teacher.group;

  const dx = playerPosition.x - group.position.x;
  const dz = playerPosition.z - group.position.z;

  const distance = Math.hypot(dx, dz);

  if (distance > teacher.triggerDistance) return;

  // FACE PLAYER
  group.rotation.y = Math.atan2(dx, dz);

  // APPROACH PLAYER
  if (distance > teacher.stopDistance) {

    const movement = Math.min(
      teacher.speed * delta,
      distance - teacher.stopDistance
    );

    group.position.x += (dx / distance) * movement;
    group.position.z += (dz / distance) * movement;
  }

  // UPDATE INTERACTION POSITION
  teacher.interaction.x = group.position.x;
  teacher.interaction.z = group.position.z;

  // TEACHER CATCH DETECTION
  const catchDistance = Math.hypot(
    playerPosition.x - group.position.x,
    playerPosition.z - group.position.z
  );

  if (catchDistance <= teacher.stopDistance + 0.15) {
    triggerTeacherCatch(teacher);
  }
}

function startTeacherChaseCooldown(completedTeacherId) {

  if (completedTeacherId === "teacherA") {
    nextTeacherToChase = "teacherB";
  }

  else if (completedTeacherId === "teacherB") {
    nextTeacherToChase = "teacherC";
  }

  else if (completedTeacherId === "teacherC") {
    nextTeacherToChase = null;
  }

  teacherChaseCooldown = 5;

  showToast("NEXT TEACHER APPROACHING IN 5 SECONDS...");
}



// ============================================================
// CEILING
// ============================================================

function buildCeiling(baseY) {
  const ceilingY = baseY + 3.62;

  addBox(
    20,
    0.22,
    30,
    M.ceiling,
    0,
    ceilingY,
    0
  );
}

function buildSecondFloorCeiling(baseY) {
  const ceilingY = baseY + 3.62;

  addBox(
    20,
    0.22,
    21,
    M.ceiling,
    0,
    ceilingY,
    -4.5
  );

  addBox(
    8.4,
    0.22,
    9,
    M.ceiling,
    -5.8,
    ceilingY,
    10.5
  );

  addBox(
    8.4,
    0.22,
    9,
    M.ceiling,
    5.8,
    ceilingY,
    10.5
  );

  addBox(
    20,
    0.22,
    0.25,
    M.ceiling,
    0,
    ceilingY,
    14.875
  );
}

// ============================================================
// FLOOR BUILDING
// ============================================================

function buildFloor(floor) {
  buildingFloor = floor;

  const baseY = FLOOR_Y[floor];

  if (floor === 3 || floor === 2) {
    addBox(
      8.4, 0.22, 30,
      M.floor,
      -5.8, baseY - 0.12, 0
    );

    addBox(
      8.4, 0.22, 30,
      M.floor,
      5.8, baseY - 0.12, 0
    );

    addBox(
      3.2, 0.22, 21,
      M.floor,
      0, baseY - 0.12, -4.5
    );

    addBox(
      3.2, 0.22, 0.25,
      M.floor,
      0, baseY - 0.12, 14.875
    );
  } else {
    addBox(
      20, 0.22, 30,
      M.floor,
      0, baseY - 0.12, 0
    );
  }

  if (floor === 3) {
    buildCeiling(baseY);
  } else {
    buildSecondFloorCeiling(baseY);
  }

  for (const side of [-1, 1]) {
    const wallX = side * 3.9;

    const wallParts = [
      { z: -12.525, length: 4.95 },
      { z: -4.5, length: 6.9 },
      { z: 4.5, length: 6.9 },
      { z: 12.525, length: 4.95 }
    ];

    wallParts.forEach(part => {
      addWall(
        0.22,
        3.82,
        part.length,
        wallX,
        baseY + 1.91,
        part.z
      );
    });

const sideNames =
  side === -1
    ? roomLabels[floor].left
    : roomLabels[floor].right;

createDoor(floor, side, -9, sideNames[0]);
createDoor(floor, side, 0, sideNames[1]);
createDoor(floor, side, 9, sideNames[2]);

    for (const doorZ of [-9, 0, 9]) {
      addBox(
        0.22,
        1.18,
        2.08,
        M.wall,
        wallX,
        baseY + 3.0,
        doorZ
      );
    }

    addWall(
      6.0,
      3.5,
      0.18,
      side * 7.0,
      baseY + 1.7,
      -4.5
    );

    addWall(
      6.0,
      3.5,
      0.18,
      side * 7.0,
      baseY + 1.7,
      4.5
    );

    const exteriorSegments = [
      { z: -12.7, length: 4.6 },
      { z: -4.5, length: 6.2 },
      { z: 4.5, length: 6.2 },
      { z: 12.7, length: 4.6 }
    ];

    exteriorSegments.forEach(part => {
      addWall(
        0.25,
        3.82,
        part.length,
        side * 10,
        baseY + 1.91,
        part.z
      );
    });

    [-9, 0, 9].forEach(z => {
      const windowWidth = 2.8;
      const windowHeight = 1.85;

      const windowY = baseY + 2.15;
      const bottomY = windowY - windowHeight / 2;
      const topY = windowY + windowHeight / 2;

      addWall(
        0.25,
        bottomY - baseY,
        windowWidth,
        side * 10,
        baseY + (bottomY - baseY) / 2,
        z
      );

      addWall(
        0.25,
        baseY + 3.82 - topY,
        windowWidth,
        side * 10,
        topY + (baseY + 3.82 - topY) / 2,
        z
      );

      addExteriorWindow(
        side,
        z,
        windowY,
        windowWidth,
        windowHeight
      );
    });

    addBox(
      0.25, 0.18, 30,
      M.wallAccent,
      side * 3.82,
      baseY + 0.09,
      0
    );

    addBox(
      0.25, 0.18, 30,
      M.wallAccent,
      side * 9.82,
      baseY + 0.09,
      0
    );
  }

  const hallWindowWidth = 2.0;
  const hallWindowHeight = 1.55;

  const hallWindowY = baseY + 2.2;
  const hallBottomY = hallWindowY - hallWindowHeight / 2;
  const hallTopY = hallWindowY + hallWindowHeight / 2;

  addWall(
    9.0, 3.82, 0.22,
    -5.5, baseY + 1.91, -15
  );

  addWall(
    9.0, 3.82, 0.22,
    5.5, baseY + 1.91, -15
  );

  addWall(
    hallWindowWidth,
    hallBottomY - baseY,
    0.22,
    0,
    baseY + (hallBottomY - baseY) / 2,
    -15
  );

  addWall(
    hallWindowWidth,
    baseY + 3.82 - hallTopY,
    0.22,
    0,
    hallTopY + (baseY + 3.82 - hallTopY) / 2,
    -15
  );

  addWall(
    20, 3.82, 0.22,
    0, baseY + 1.91, 15
  );

  addHallwayWindow(
    -14.82,
    hallWindowY,
    hallWindowWidth,
    hallWindowHeight
  );

  for (const z of [-11, -5, 2]) {
    addCeilingLight(0, baseY + 3.47, z);
  }

  addPoster(
    "KEEP YOUR SCHOOL CLEAN",
    -3.73,
    baseY + 2.1,
    -5.7,
    Math.PI / 2
  );

  addPoster(
    "STAY FOCUSED",
    3.73,
    baseY + 2.1,
    5.8,
    -Math.PI / 2
  );

const roomZPositions = [-9, 0, 9];

for (const side of [-1, 1]) {
  const sideNames =
    side === -1
      ? roomLabels[floor].left
      : roomLabels[floor].right;

  for (let i = 0; i < roomZPositions.length; i++) {
    addLabel(
      sideNames[i],
      side * 3.76,
      baseY + 2.72,
      roomZPositions[i],
      side === -1 ? Math.PI / 2 : -Math.PI / 2
    );
  }
}

  buildFloorFurniture(floor, baseY);
  buildStairs(floor, baseY);
}

// ============================================================
// ORGANIZED FURNITURE
// ============================================================

// ============================================================
// EXAMINATION STUDENT
// ============================================================


function makeExamStudent(
  x,
  baseY,
  z,
  shirtColor = 0x547b83
) {

  const student = new THREE.Group();

  const shirtMat = mat(shirtColor);
  const pantsMat = mat(0x303747);
  const skinMat = M.skin;
  const hairMat = M.hair;

  // SEATED BODY
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.23, 0.28, 0.68, 16),
    shirtMat
  );

  body.position.y = 1.0;
  student.add(body);

  // HEAD PIVOT
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.52, 0);
  student.add(headGroup);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 18, 18),
    skinMat
  );

  headGroup.add(head);

  // HAIR
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(
      0.22, 16, 14, 0, Math.PI * 2, 0, Math.PI / 2
    ),
    hairMat
  );

  hair.position.set(0, 0.08, -0.01);
  headGroup.add(hair);

  // EYES
  for (const side of [-1, 1]) {

    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 10, 10),
      mat(0xffffff)
    );

    eye.position.set(side * 0.07, 0.01, 0.18);
    headGroup.add(eye);

    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 8, 8),
      mat(0x211b19)
    );

    pupil.position.set(side * 0.07, 0.01, 0.198);
    headGroup.add(pupil);
  }

  // SEATED LEGS
  for (const side of [-1, 1]) {

    const thigh = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.42),
      pantsMat
    );

    thigh.position.set(side * 0.12, 0.58, 0.18);
    student.add(thigh);

    const lowerLeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.38, 0.14),
      pantsMat
    );

    lowerLeg.position.set(side * 0.12, 0.32, 0.40);
    student.add(lowerLeg);
  }

  // ANIMATED ARMS
  const arms = [];

  for (const side of [-1, 1]) {

    const armGroup = new THREE.Group();

    armGroup.position.set(
      side * 0.22,
      1.02,
      0.22
    );

    const arm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.055, 0.28, 4, 8),
      shirtMat
    );

    arm.position.set(0, -0.04, 0.05);
    arm.rotation.x = -0.9;
    armGroup.add(arm);

    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 10, 10),
      skinMat
    );

    hand.position.set(-side * 0.03, -0.12, 0.17);
    armGroup.add(hand);

    student.add(armGroup);
    arms.push(armGroup);
  }

  // ANIMATED PENCIL
  const pencil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.30, 8),
    mat(0xe2bd48)
  );

  pencil.position.set(0.17, 0.91, 0.43);
  pencil.rotation.x = Math.PI / 2;
  student.add(pencil);

  // FACE THE DESK
  student.position.set(x, baseY, z);
  student.rotation.y = Math.PI;

  scene.add(student);

  // SAVE ANIMATION REFERENCES
  examStudents.push({
    group: student,
    arms,
    head: headGroup,
    pencil,
    phase: Math.random() * Math.PI * 2,
    speed: 2 + Math.random() * 1.5
  });

  return student;
}


function buildFloorFurniture(floor, baseY) {

  // ==================================================
  // THIRD FLOOR
  // ==================================================

  if (floor === 3) {

    // ROOM 301 — COMPUTER LAB
    // Existing task furniture and positions are preserved.

    makeComputer(-8.25, baseY, -11.6);
    makeComputer(-5.45, baseY, -11.6);
    makeComputer(-8.25, baseY, -7.1);
    makeComputer(-5.45, baseY, -7.1);

    makeCabinet(-9.0, baseY, -5.9);
    makeBookshelf(-4.8, baseY, -5.9);

    makeWhiteboard(-7.0, baseY, -14.7);

    makePlant(-9.0, baseY, -4.9);

    // Actual visible wires at the diagnostic computer.
    makeWireBundle(-5.45, baseY, -7.1);

    addInteractable(
      3,
      -8.25,
      -11.6,
      "FROZEN COMPUTER",
      "The computer has stopped responding while your thesis document is open.",
      "computer",
      "computer"
    );

    addInteractable(
      3,
      -8.25,
      -7.1,
      "NETWORK ROUTER",
      "The computer laboratory has lost its internet connection.",
      "router",
      "router"
    );

    addInteractable(
      3,
      -5.45,
      -7.1,
      "SYSTEM DIAGNOSTIC",
      "Your thesis file needs to be checked before you leave the computer lab.",
      "diagnostic",
      "diagnostic"
    );


    // ROOM 302 — CLASSROOM
    // Left side, middle room.

    makeWhiteboard(-7.0, baseY, -4.35, Math.PI);

    makeDesk(-8.0, baseY, -1.8, 1.5);
    makeChair(-8.0, baseY, -0.62);

    makeDesk(-5.5, baseY, -1.8, 1.5);
    makeChair(-5.5, baseY, -0.62);

    makeCabinet(-9.0, baseY, 3.55);
    makeBookshelf(-5.0, baseY, 3.55);

    makePlant(-9.1, baseY, 0.9);

    makePaper(-8.0, baseY, -1.8);
    makePaper(-5.5, baseY, -1.8, 0.15);

    makeFloorPaper(-6.7, baseY, 1.1, 0.25);
    makeFloorPaper(-8.8, baseY, 2.5, -0.3);


    // ROOM 303 — FACULTY ROOM
    // Left side, back room.

    makeWhiteboard(-7.0, baseY, 4.65, Math.PI);

    makeComputer(-8.1, baseY, 7.3);
    makeComputer(-5.5, baseY, 7.3);

    makeDesk(-8.1, baseY, 11.4, 1.65);
    makeChair(-8.1, baseY, 12.58);

    makeDesk(-5.5, baseY, 11.4, 1.65);
    makeChair(-5.5, baseY, 12.58);

    makeCabinet(-9.0, baseY, 14.0);
    makePrinter(-5.2, baseY, 14.0);

    makeBookshelf(-5.0, baseY, 5.6);
    makePlant(-9.0, baseY, 5.6);

    // Papers and faculty materials.
    makeFolder(-8.1, baseY, 11.4);
    makePaper(-5.5, baseY, 11.4);
    makeOfficeSupplies(-8.1, baseY, 7.55);

    makeFloorPaper(-7.0, baseY, 9.8, 0.35);
    makeFloorPaper(-9.2, baseY, 12.0, -0.2);
    makeFloorPaper(-5.0, baseY, 9.9, 0.5);


    // ROOM 304 — CLASSROOM
    // Right side, front room.

    makeWhiteboard(7.0, baseY, -14.7);

    makeDesk(5.5, baseY, -10.5, 1.5);
    makeChair(5.5, baseY, -9.32);

    makeDesk(8.2, baseY, -10.5, 1.5);
    makeChair(8.2, baseY, -9.32);

    makeDesk(6.85, baseY, -6.2, 1.5);
    makeChair(6.85, baseY, -5.05);

    makeCabinet(9.0, baseY, -5.7);
    makeBookshelf(5.0, baseY, -5.7);

    makePlant(9.0, baseY, -4.85);

    makePaper(5.5, baseY, -10.5);
    makePaper(8.2, baseY, -10.5, 0.2);

    makeFloorPaper(7.4, baseY, -7.7, 0.4);


    // ROOM 305 — STUDY ROOM
    // Right side, middle room.

    makeWhiteboard(7.0, baseY, -4.35, Math.PI);

    makeDesk(5.4, baseY, -1.8, 1.5);
    makeChair(5.4, baseY, -0.62);

    makeDesk(8.2, baseY, -1.8, 1.5);
    makeChair(8.2, baseY, -0.62);

    makeDesk(6.8, baseY, 2.0, 1.8);
    makeChair(6.8, baseY, 3.2);

    makeBookshelf(9.0, baseY, 3.7);
    makePlant(4.9, baseY, 3.7);

    // Study materials scattered on the table.
    makeFolder(6.25, baseY, 2.0);
    makePaper(7.35, baseY, 2.0, 0.18);
    makeOfficeSupplies(6.8, baseY, 1.55);

    makeFloorPaper(5.0, baseY, 0.9, -0.25);
    makeFloorPaper(8.9, baseY, 1.6, 0.4);


    // ROOM 306 — FACULTY / CONSULTATION ROOM
    // Right side, back room.

    makeWhiteboard(7.0, baseY, 4.65, Math.PI);

    makeComputer(5.5, baseY, 7.3);
    makeComputer(8.1, baseY, 7.3);

    makeDesk(5.5, baseY, 11.4, 1.65);
    makeChair(5.5, baseY, 12.58);

    makeDesk(8.1, baseY, 11.4, 1.65);
    makeChair(8.1, baseY, 12.58);

    makeCabinet(9.1, baseY, 14.0);
    makeBookshelf(5.0, baseY, 5.6);

    makePlant(9.0, baseY, 5.6);

    makeFolder(5.5, baseY, 11.4);
    makePaper(8.1, baseY, 11.4);
    makeOfficeSupplies(5.5, baseY, 7.55);

    makeFloorPaper(6.8, baseY, 9.8, 0.3);
    makeFloorPaper(9.1, baseY, 12.0, -0.2);


    // TWO STUDENTS WALKING TOGETHER
    makeAmbientNPC(
      -0.45, baseY, 5,
      0x547b83,
      {
        walking: true,
        direction: 1,
        speed: 0.55,
        minZ: 2,
        maxZ: 8,
        backpack: true
      }
    );

    makeAmbientNPC(
      0.45, baseY, 5,
      0x826a91,
      {
        walking: true,
        direction: 1,
        speed: 0.55,
        minZ: 2,
        maxZ: 8,
        book: true
      }
    );

  }


  // ==================================================
  // SECOND FLOOR
  // ==================================================

  if (floor === 2) {

    // ROOM 201 — CLASSROOM

    makeWhiteboard(-7.0, baseY, -14.7);

    for (const z of [-10.8, -6.2]) {
      for (const x of [-8.2, -5.4]) {
        makeDesk(x, baseY, z, 1.45);
        makeChair(x, baseY, z + 1.18);
      }
    }

    makeBookshelf(-9.0, baseY, -5.0);
    makeCabinet(-4.8, baseY, -5.0);
    makePlant(-9.0, baseY, -4.7);

// ==================================================
// ROOM 204 — CLASSROOM / EXAMINATION ROOM
// ==================================================

makeWhiteboard(7.0, baseY, -14.7);

// FIRST ROW
makeDesk(5.5, baseY, -10.5, 1.5);
makePaper(5.5, baseY, -10.5);

makeDesk(8.3, baseY, -10.5, 1.5);
makePaper(8.3, baseY, -10.5, 0.15);

// SECOND ROW
makeDesk(5.5, baseY, -8.0, 1.5);
makePaper(5.5, baseY, -8.0, 0.2);

makeDesk(8.3, baseY, -8.0, 1.5);
makePaper(8.3, baseY, -8.0, -0.15);

// EXAM STUDENTS — SEATED IN FRONT OF THEIR DESKS
makeExamStudent(
  5.5, baseY, -9.25,
  0x547b83
);

makeExamStudent(
  8.3, baseY, -9.25,
  0x826a91
);

makeExamStudent(
  5.5, baseY, -6.75,
  0x55745f
);

makeExamStudent(
  8.3, baseY, -6.75,
  0xb97849
);

// CLASSROOM FURNITURE
makeBookshelf(9.0, baseY, -13.1);
makePlant(5.0, baseY, -13.1);

// ==================================================
// ROOM 202 — GROUP STUDY ROOM
// ==================================================

// GROUP STUDY TABLE
makeDesk(-6.2, baseY, 3.0, 2.2);

// FOUR CHAIRS
makeChair(-7.5, baseY, 4.25);
makeChair(-4.9, baseY, 4.25);
makeChair(-7.5, baseY, 1.75);
makeChair(-4.9, baseY, 1.75);

// STUDY MATERIALS
makePaper(-6.2, baseY, 3.0);
makeFolder(-6.7, baseY, 3.0);
makeOfficeSupplies(-5.8, baseY, 3.0);

// ADDITIONAL FURNITURE
makeBookshelf(-9.0, baseY, 4.0);
makeWhiteboard(-7.0, baseY, 5.0, Math.PI);
makeComputer(-8.0, baseY, 2.0);
makePlant(-9.0, baseY, 1.0);

    // KRISTINE — GIRL, SHORT BLACK HAIR
    makeNPC(-6.2, baseY, -7.0, 0x547b83, {
      longHair: false
    });

// ENIR — ROOM 202
makeNPC(-6.2, baseY, 0, 0x826a91, {
  curlyHair: true,
  glasses: true
});

    // JIO — BOY, TWO DISTINCTIVE MOLES
    makeNPC(-3.5, baseY, -7.0, 0x52665c, {
      moles: [
        { side: "left", position: "cheek" },
        { side: "right", position: "forehead" }
      ]
    });

    // ROVELIN — GIRL, LONG BLACK HAIR WITH HAIR CLIP
    makeNPC(3.5, baseY, -7.0, 0x98765b, {
      longHair: true,
      hairClip: true
    });

    // GROUPMATE INTERACTABLES
    addInteractable(2, -6.2, -7.0, "KRISTINE", "Hi! Here's my contribution for our thesis printing expenses.", "kristine", "npc");

addInteractable(
  2, -6.2, 0,
  "ENIR",
  "Here's my share for the thesis printing expenses!",
  "enir", "npc"
);
    addInteractable(2, -3.5, -7.0, "JIO", "I brought my contribution. Good luck with the submission!", "jio", "npc");

    addInteractable(2, 3.5, -7.0, "ROVELIN", "Here's my contribution. Let's finish our thesis!", "rovelin", "npc");


    // ROOM 203 — FACULTY ROOM / THESIS REVIEW

    makeWhiteboard(9.935, baseY, 5.0, Math.PI / 2);

    makeComputer(5.25, baseY, 6.3);
    makeComputer(8.35, baseY, 6.3);

    makeDesk(5.3, baseY, 10.4);
    makeChair(5.3, baseY, 11.65);

    makeDesk(8.3, baseY, 10.4);
    makeChair(8.3, baseY, 11.65);

    makeCabinet(9.0, baseY, 13.35);
    makePrinter(6.9, baseY, 13.35);

    makeFolder(5.3, baseY, 10.4);
    makePaper(8.3, baseY, 10.4);
    makeOfficeSupplies(8.3, baseY, 7.8);
    makePlant(9.0, baseY, 5.2);

    // ADDITIONAL FACULTY ROOM FURNITURE
makeBookshelf(9.0, baseY, 3.5);
makeCabinet(9.0, baseY, 11.0);

// TEACHER A
const teacherAVisual = makeNPC(
  5.3, baseY, 8.0, 0x536c82,
  {
    rotationY: Math.PI,
    noCollider: true
  }
);

addInteractable(
  2, 5.3, 8.0,
  "TEACHER A",
  "Can you help me deliver these documents to Room 205?",
  "teacherA", "teacher"
);

registerMovingTeacher(
  "teacherA",
  teacherAVisual,
  interactables[interactables.length - 1]
);


// TEACHER B
const teacherBVisual = makeNPC(
  8.3, baseY, 8.0, 0x55745f,
  {
    rotationY: Math.PI,
    noCollider: true
  }
);

addInteractable(
  2, 8.3, 8.0,
  "TEACHER B",
  "Can you watch the examination room for a little while?",
  "teacherB", "teacher"
);

registerMovingTeacher(
  "teacherB",
  teacherBVisual,
  interactables[interactables.length - 1]
);


// TEACHER C
const teacherCVisual = makeNPC(
  7.0, baseY, 12.0, 0xb97849,
  {
    rotationY: Math.PI,
    noCollider: true
  }
);

addInteractable(
  2, 7.0, 12.0,
  "TEACHER C",
  "Could you get an office item for me? Please pick it up from my office and bring it back to me.",
  "teacherC", "teacher"
);

registerMovingTeacher(
  "teacherC",
  teacherCVisual,
  interactables[interactables.length - 1]
);

// ROOM 205 — DOCUMENT DELIVERY TABLE
makeDesk(7.0, baseY, 0, 1.8);
makeFolder(7.0, baseY, 0);

// ROOM 205 — DOCUMENT DELIVERY
addInteractable(
  2,
  7.0,
  0,
  "ROOM 205 — DOCUMENT DELIVERY",
  "You found the correct room. Deliver Teacher A's documents here.",
  "room205Delivery",
  "favorTarget"
);


// ROOM 204 — EXAMINATION ROOM WATCH
addInteractable(
  2,
  7.0,
  -9.0,
  "ROOM 204 — EXAMINATION ROOM",
  "Stay inside the examination room for 30 seconds.",
  "room204Watch",
  "favorTarget"
);


// ROOM 206 — TEACHER C OFFICE ITEM
addInteractable(
  2,
  5.3,
  10.4,
  "OFFICE ITEM",
  "Pick up the office item requested by Teacher C.",
  "teacherCItem",
  "favorTarget"
);

// STUDENTS READING NOTES
makeAmbientNPC(
  -1.2,
  baseY,
  6,
  0x98765b,
  {
    book: true,
    backpack: true
  }
);

makeAmbientNPC(
  1.2,
  baseY,
  6,
  0x826a91,
  {
    book: true
  }
);

// STUDENTS TALKING
makeAmbientNPC(-1.3, baseY, -2, 0x55745f, {
  rotationY: Math.PI / 2
});

makeAmbientNPC(-0.6, baseY, -2.5, 0xb97849, {
  rotationY: -Math.PI / 2
});


    // STUDENTS WAITING IN THE HALLWAY
    makeAmbientNPC(
      -1.2,
      baseY,
      3,
      0x536c82,
      {
        rotationY: Math.PI,
        backpack: true
      }
    );

    makeAmbientNPC(
      1.2,
      baseY,
      3.5,
      0xb97849,
      {
        rotationY: Math.PI,
        book: true
      }
    );

        // FIVE DECOY STUDENTS
    // These are NOT the correct groupmates.

    makeNPC(-1.35, baseY, -12, 0x9b7657, {
      bangs: true
    });

    addInteractable(
      2, -1.35, -12,
      "STUDENT",
      "Hello! Do you need something?",
      "decoy1",
      "decoy"
    );

    makeNPC(1.35, baseY, -9.5, 0x55745f, {
      curlyHair: true
    });

    addInteractable(
      2, 1.35, -9.5,
      "STUDENT",
      "Hi! I'm just waiting for my class.",
      "decoy2",
      "decoy"
    );

    makeNPC(-1.35, baseY, -5, 0x826a91, {
      longHair: true
    });

    addInteractable(
      2, -1.35, -5,
      "STUDENT",
      "Sorry, I don't have the thesis contribution.",
      "decoy3",
      "decoy"
    );

    makeNPC(1.35, baseY, 0, 0xb97849, {
      glasses: true
    });

    addInteractable(
      2, 1.35, 0,
      "STUDENT",
      "Are you looking for someone?",
      "decoy4",
      "decoy"
    );

    makeNPC(1.35, baseY, -5, 0x536c82, {
      tiedBack: true
    });

    addInteractable(
      2, 1.35, -5,
      "STUDENT",
      "I think you have the wrong person.",
      "decoy5",
      "decoy"
    );

}


  // ==================================================
  // FIRST FLOOR
  // ==================================================

  if (floor === 1) {

    // ROOM 101 — PRINTING ROOM

    makeWhiteboard(-7.0, baseY, -14.7);
    makePrinter(-8.0, baseY, -11.0);

    makeDesk(-5.3, baseY, -11.0);
    makeChair(-5.3, baseY, -9.75);

    makeCabinet(-9.0, baseY, -6.0);
    makeBookshelf(-5.0, baseY, -6.0);

    makePaper(-8.0, baseY, -10.0);
    makeFolder(-5.3, baseY, -10.9);
    makePlant(-9.0, baseY, -4.8);


    // ROOM 102 — LOBBY / WAITING AREA

    makeWhiteboard(7.0, baseY, -14.7);

    makeDesk(6.0, baseY, -10.5, 1.8);
    makeChair(6.0, baseY, -9.2, 0x536c82);

    makeChair(8.3, baseY, -10.5, 0x55745f);
    makeChair(8.3, baseY, -8.9, 0x55745f);

    makePlant(9.0, baseY, -5.5);
    makeCabinet(5.0, baseY, -5.5);
    makeBookshelf(8.8, baseY, -4.9);


    // ROOM 103 — SUBMISSION OFFICE

    makeWhiteboard(9.935, baseY, 5.0, Math.PI / 2);

    makeDesk(6.2, baseY, 7.0);
    makeChair(6.2, baseY, 8.25);

    makeBookshelf(9.0, baseY, 11.4);
    makeCabinet(5.0, baseY, 11.4);

    makeNPC(6.2, baseY, -7.0, 0x52665c);

    makePaper(6.2, baseY, 7.0);
    makeFolder(7.1, baseY, 7.0);
    makeOfficeSupplies(8.2, baseY, 7.0);

    makePlant(9.0, baseY, 5.2);


    addInteractable(
      1, -8.0, -11.0,
      "PRINTING MACHINE",
      "Your thesis document is ready, but the printer needs to be prepared.",
      "printer", "printer"
    );

    addInteractable(
      1, 6.2, -10.5,
      "BINDING STATION",
      "The printed thesis pages need to be arranged and bound correctly.",
      "binding", "binding"
    );

    addInteractable(
      1, 6.2, 7.0,
      "SUBMISSION OFFICE",
      "The staff member is waiting to receive your final thesis.",
      "submission", "submission"
    );
  }

  // CREATE AMBIENT NPCs FOR THE CURRENT FLOOR
   buildAmbientNPCs(floor, baseY);

}

// ============================================================
// BUILD ALL FLOORS
// ============================================================

buildFloor(3);
buildFloor(2);
buildFloor(1);

// ============================================================
// CHALLENGE BANK
// ============================================================

const challengeBank = {
  computer: [
    [
      "The computer is frozen. What should you do first?",
      [
        "Wait briefly and check if the system responds.",
        "Remove the memory.",
        "Turn off the power immediately."
      ],
      0
    ],
    [
      "Which device is used to type information into a computer?",
      [
        "Monitor",
        "Keyboard",
        "Speaker"
      ],
      1
    ],
    [
      "Which device displays the computer's output?",
      [
        "Monitor",
        "Mouse",
        "Printer"
      ],
      0
    ]
  ],

  router: [
    [
      "What device provides network connectivity?",
      [
        "Router",
        "Keyboard",
        "Speaker"
      ],
      0
    ],
    [
      "The router has no internet indicator. What should you inspect?",
      [
        "The keyboard",
        "The power and internet indicators",
        "The wallpaper"
      ],
      1
    ],
    [
      "The connection returns. What should you do?",
      [
        "Test a reliable website",
        "Disconnect the router",
        "Delete your browser"
      ],
      0
    ]
  ],

  diagnostic: [
    [
      "Which thesis file should you use?",
      [
        "An old draft",
        "The latest approved document",
        "A random file"
      ],
      1
    ],
    [
      "What should you check before printing?",
      [
        "Page order, margins, spelling, and sections",
        "Wallpaper",
        "Volume"
      ],
      0
    ],
    [
      "Why is it important to keep a backup?",
      [
        "To change the wallpaper",
        "To increase monitor brightness",
        "To recover the document if the original is damaged"
      ],
      2
    ]
  ],

  groupmate1: [
    [
      "What should the research background explain?",
      [
        "The research problem and context",
        "Only images",
        "Decorative headings"
      ],
      0
    ],
    [
      "What should you verify in related literature?",
      [
        "Same publication year",
        "Relevant sources and correct citations",
        "No references"
      ],
      1
    ],
    [
      "You found two sources with conflicting findings. What should you do?",
      [
        "Ignore both sources",
        "Copy only the first source",
        "Compare their methods, evidence, and relevance before synthesizing"
      ],
      2
    ]
  ],

  groupmate2: [
    [
      "What should you check in the methodology?",
      [
        "Research design matches the questions",
        "Font color",
        "Length only"
      ],
      0
    ],
    [
      "What should data gathering procedures include?",
      [
        "Personal stories",
        "Clear collection steps",
        "Only researcher names"
      ],
      1
    ],
    [
      "The chosen research design does not answer one research question. What should you do?",
      [
        "Remove the research question",
        "Continue without changes",
        "Review the alignment between the research questions, design, instruments, and analysis"
      ],
      2
    ]
  ],

  thesis: [
    [
      "What should you do with the thesis chapters?",
      [
        "Arrange them in the required order",
        "Remove the contents",
        "Put references first"
      ],
      0
    ],
    [
      "Page numbers do not match. What should you check?",
      [
        "Volume",
        "Table of contents and heading styles",
        "Wallpaper"
      ],
      1
    ],
    [
      "The document has inconsistent headings and page numbering. What is the best solution?",
      [
        "Manually delete random pages",
        "Ignore the table of contents",
        "Correct the heading styles and regenerate the table of contents"
      ],
      2
    ]
  ],

  printer: [
    [
      "What should you check before printing?",
      [
        "Paper, power, and connection",
        "Wallpaper",
        "Lights only"
      ],
      0
    ],
    [
      "Pages are cut off in the preview. What should you adjust?",
      [
        "Change brightness",
        "Paper size, orientation, and margins",
        "Move the printer"
      ],
      1
    ],
    [
      "Why should you print a test page first?",
      [
        "To waste paper",
        "To change the printer's color",
        "To verify layout, alignment, and print quality before printing the full document"
      ],
      2
    ]
  ],

  binding: [
    [
      "Printed pages are mixed up. What should you do?",
      [
        "Arrange pages in order",
        "Bind immediately",
        "Remove random pages"
      ],
      0
    ],
    [
      "What should you check before binding?",
      [
        "Cover color only",
        "Missing, upside-down, or duplicated pages",
        "Different page sizes"
      ],
      1
    ],
    [
      "The document is complete but some pages are misaligned. What is the best action?",
      [
        "Bind it immediately",
        "Remove the title page",
        "Recheck the page sequence, align the edges, and attach the correct cover"
      ],
      2
    ]
  ],

  submission: [
    [
      "What should you verify before submission?",
      [
        "The printed and bound copy is complete",
        "Pages are loose",
        "No title page"
      ],
      0
    ],
    [
      "What information should be correct?",
      [
        "Font color",
        "Title, researchers, course, and institution",
        "Random title"
      ],
      1
    ],
    [
      "A staff member finds an incomplete required section. What should you do?",
      [
        "Ask the staff to ignore it",
        "Submit without checking",
        "Correct the missing section and verify the complete submission requirements"
      ],
      2
    ]
  ]
};

const taskDescriptions = {
  computer: "Repair the frozen computer and recover your thesis document.",
  router: "Restore the internet connection in the computer laboratory.",
  diagnostic: "Check the final thesis file before continuing.",
  groupmate1: "Collect the research background and related literature.",
  groupmate2: "Collect the methodology and data gathering notes.",
  thesis: "Organize the final thesis document.",
  printer: "Prepare the printing machine and print your thesis.",
  binding: "Arrange the pages and prepare the final binding.",
  submission: "Submit your completed thesis to the office."
};

function getObjectiveNumber(item) {
  const tasks = floorInfo[item.floor].tasks;

  return tasks.findIndex(task => task[1] === item.id) + 1;
}

function getObjectiveDifficulty(item) {
  const number = getObjectiveNumber(item);

  if (number === 1) return "EASY";
  if (number === 2) return "MEDIUM";

  return "HARD";
}

// ============================================================
// HUD
// ============================================================

function updateHUD() {
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  $("timer").textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  $("score").textContent = String(score).padStart(4, "0");

  const suffix =
    currentFloor === 3 ? "RD" :
    currentFloor === 2 ? "ND" : "ST";

  $("floor-display").textContent =
    `${currentFloor}${suffix} FLOOR`;

  const info = floorInfo[currentFloor];

  $("location-name").textContent =
    `${currentFloor}${suffix} FLOOR`;

  $("floor-description").textContent = info.description;

  const objectiveList = $("objective-list");

  objectiveList.innerHTML = "";

  info.tasks.forEach((task, index) => {
    const item = document.createElement("div");

    item.className = "objective-item";

    const done = completedTasks.has(task[1]);

    const difficulty =
      index === 0 ? "EASY" :
      index === 1 ? "MEDIUM" : "HARD";

    item.innerHTML =
      `<span class="objective-status">${done ? "✓" : "○"}</span>
       <span>${task[0]}
       <small style="display:block;font-size:10px;opacity:.65;margin-top:3px">
       ${difficulty}
       </small>
       </span>`;

    if (done) item.classList.add("completed");

    objectiveList.appendChild(item);
  });

  const count = info.tasks.filter(task =>
    completedTasks.has(task[1])
  ).length;

  const total = info.tasks.length;

  $("progress-fill").style.width =
    `${count / total * 100}%`;

  $("progress-text").textContent = `${count} / ${total}`;

  $("lives").textContent = String(lives);
}

function showToast(message) {
  const toast = $("toast");

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

// ============================================================
// COLLISION SYSTEM
// ============================================================

function blocked(x, z) {
  const hitStatic = colliders.some(c => {
    if (c.floor !== currentFloor) return false;

    return (
      x + PLAYER_RADIUS > c.minX &&
      x - PLAYER_RADIUS < c.maxX &&
      z + PLAYER_RADIUS > c.minZ &&
      z - PLAYER_RADIUS < c.maxZ
    );
  });

  if (hitStatic) return true;

  for (const door of doors) {
    if (door.floor !== currentFloor || door.open) continue;

    const hingeX = door.x;
    const hingeZ = door.z - 0.92;

    const dx = x - hingeX;
    const dz = z - hingeZ;

    const c = Math.cos(door.angle);
    const s = Math.sin(door.angle);

    const localX = c * dx - s * dz;
    const localZ = s * dx + c * dz;

    if (
      Math.abs(localX) < PLAYER_RADIUS + 0.10 &&
      localZ > -PLAYER_RADIUS &&
      localZ < 1.82 + PLAYER_RADIUS
    ) {
      return true;
    }
  }

  return false;
}

// ============================================================
// PLAYER
// ============================================================

function setPlayerFloor(floor, x = 0, z = 0) {
  currentFloor = floor;

  verticalVelocity = 0;
  isJumping = false;
  stairBlockedNotice = false;

  playerPosition.set(
    x,
    FLOOR_Y[floor] + PLAYER_HEIGHT,
    z
  );

  camera.position.copy(playerPosition);

  updateHUD();
}

function jump() {
  if (
    !gameStarted ||
    gamePaused ||
    gameFinished ||
    activeInteraction ||
    isJumping
  ) return;

  isJumping = true;
  verticalVelocity = JUMP_FORCE;
}

// ============================================================
// WALKING AND STAIR MOVEMENT
// ============================================================

function movePlayer(delta) {
  if (
    !gameStarted ||
    gamePaused ||
    gameFinished ||
    activeInteraction
  ) return;

  const speed = 4.2;

  const forward = new THREE.Vector3(
    -Math.sin(yaw),
    0,
    -Math.cos(yaw)
  );

  const right = new THREE.Vector3(
    Math.cos(yaw),
    0,
    -Math.sin(yaw)
  );

  const movement = new THREE.Vector3();

  if (keys.w || keys.arrowup) movement.add(forward);
  if (keys.s || keys.arrowdown) movement.sub(forward);
  if (keys.d || keys.arrowright) movement.add(right);
  if (keys.a || keys.arrowleft) movement.sub(right);

  if (movement.lengthSq() > 0) {
    movement.normalize().multiplyScalar(speed * delta);

    const nextX = playerPosition.x + movement.x;
    const nextZ = playerPosition.z + movement.z;

    if (!blocked(nextX, playerPosition.z)) {
      playerPosition.x = nextX;
    }

    let allowedZ = nextZ;

    const insideStairLane =
      Math.abs(playerPosition.x) < 1.38;

    if (
      currentFloor > 1 &&
      insideStairLane &&
      playerPosition.z >= 7.6 &&
      allowedZ >= 14.0
    ) {
      const nextFloor = currentFloor - 1;

      setPlayerFloor(nextFloor, 0, 7.0);

      showToast(
        `You reached the ${nextFloor === 2 ? "SECOND" : "FIRST"} FLOOR! Your progress is saved.`
      );

      return;
    }

    if (allowedZ < 13.5) {
      stairBlockedNotice = false;
    }

    if (!blocked(playerPosition.x, allowedZ)) {
      playerPosition.z = allowedZ;
    }
  }

  playerPosition.x = THREE.MathUtils.clamp(
    playerPosition.x,
    -9.4,
    9.4
  );

  playerPosition.z = THREE.MathUtils.clamp(
    playerPosition.z,
    -14.3,
    14.3
  );

  const baseGroundY = FLOOR_Y[currentFloor];

  let stairDrop = 0;

  if (
    currentFloor > 1 &&
    Math.abs(playerPosition.x) < 1.48 &&
    playerPosition.z >= 7.6 &&
    playerPosition.z <= 14.0
  ) {
    const progress = THREE.MathUtils.clamp(
      (playerPosition.z - 7.6) / (14.0 - 7.6),
      0,
      1
    );

    stairDrop = progress * FLOOR_HEIGHT;
  }

  const groundY =
    baseGroundY + PLAYER_HEIGHT - stairDrop;

  if (isJumping) {
    verticalVelocity -= GRAVITY * delta;
    playerPosition.y += verticalVelocity * delta;

    if (playerPosition.y <= groundY) {
      playerPosition.y = groundY;
      verticalVelocity = 0;
      isJumping = false;
    }
  } else {
    playerPosition.y = groundY;
  }

  camera.position.copy(playerPosition);
}

// ============================================================
// INTERACTION
// ============================================================

function nearestInteractable() {
  let closest = null;
  let shortest = 2.65;

  for (const item of interactables) {
    if (item.floor !== currentFloor) continue;

    const distance = Math.hypot(
      playerPosition.x - item.x,
      playerPosition.z - item.z
    );

    if (distance < shortest) {
      shortest = distance;
      closest = item;
    }
  }

  return closest;
}

function isNearStairs() {
  return (
    currentFloor > 1 &&
    playerPosition.z >= 6.2 &&
    playerPosition.z <= 14.2 &&
    Math.abs(playerPosition.x) < 1.72
  );
}

function updatePrompt() {
  if (
    !gameStarted ||
    gamePaused ||
    gameFinished ||
    activeInteraction
  ) {
    $("interaction-prompt").classList.add("hidden");
    return;
  }

  nearbyObject = nearestInteractable();

  if (nearbyObject) {
    $("interaction-text").textContent =
      nearbyObject.kind === "door"
        ? (nearbyObject.door.open ? "CLOSE " : "OPEN ") + nearbyObject.title
        : nearbyObject.title;

    $("interaction-prompt").classList.remove("hidden");
    return;
  }

  if (isNearStairs()) {
    $("interaction-text").textContent = "WALK DOWN STAIRS";
    $("interaction-prompt").classList.remove("hidden");
    return;
  }

  $("interaction-prompt").classList.add("hidden");
}

function sitAtInteractionSeat(item) {
  const availableSeats = seatSpots.filter(
    seat => seat.floor === item.floor
  );

  let nearestSeat = null;
  let shortestDistance = Infinity;

  for (const seat of availableSeats) {
    const distance = Math.hypot(
      seat.x - item.x,
      seat.z - item.z
    );

    if (distance < shortestDistance) {
      shortestDistance = distance;
      nearestSeat = seat;
    }
  }

  // Only use a chair belonging to the task's nearby workstation.
  if (!nearestSeat || shortestDistance > 3.2) {
    return;
  }

  interactionReturnPosition = playerPosition.clone();
  interactionReturnYaw = yaw;
  interactionReturnPitch = pitch;

  currentSeat = nearestSeat;
  seatedOnChair = true;

  // Move the player onto the chair.
  playerPosition.set(
    nearestSeat.x,
    nearestSeat.baseY + 1.18,
    nearestSeat.z
  );

  // Face the task object.
  const dx = item.x - nearestSeat.x;
  const dz = item.z - nearestSeat.z;

  yaw = Math.atan2(-dx, -dz);
  pitch = 0;

  camera.position.copy(playerPosition);
  camera.rotation.set(pitch, yaw, 0);
}


function standFromInteractionSeat() {
  if (interactionReturnPosition) {
    playerPosition.copy(interactionReturnPosition);

    yaw = interactionReturnYaw;
    pitch = interactionReturnPitch;

    camera.position.copy(playerPosition);
    camera.rotation.set(pitch, yaw, 0);
  }

  interactionReturnPosition = null;
  seatedOnChair = false;
  currentSeat = null;
}

function openTeacherInteraction(item) {
  activeInteraction = item;

  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }

  pointerLocked = false;
  document.body.classList.add("cursor-visible");

  $("interaction-category").textContent = "OPTIONAL TEACHER FAVOR";
  $("interaction-title").textContent = item.title;

  const accepted = acceptedFavors.has(item.id);
  const completed = completedFavors.has(item.id);

  if (completed) {
    $("interaction-description").textContent =
      "Thank you for helping me! I appreciate your effort.";

    $("interaction-extra").innerHTML = `
      <p>FAVOR COMPLETED!</p>
    `;

  } else if (accepted) {
    let message = "You already accepted this favor. Complete the requested task first!";

    if (item.id === "teacherC" && teacherCItemCollected) {
      message = "You already have the item. Please return it to me!";
    }

    $("interaction-description").textContent = message;

    $("interaction-extra").innerHTML = `
      <p>FAVOR ACCEPTED — NOT YET COMPLETED</p>
    `;

  } else {
    $("interaction-description").textContent = item.description;

    $("interaction-extra").innerHTML = `
      <button id="accept-favor" class="primary-button">
        ACCEPT
      </button>

      <button id="decline-favor" class="secondary-button">
        DECLINE
      </button>
    `;

$("accept-favor").addEventListener("click", () => {

  acceptedFavors.add(item.id);

  // Stop the teacher from following the player.
  stopTeacherApproach(item.id);

  if (item.id === "teacherA") {
    showCarriedDocuments();

    showToast(
      "DOCUMENTS RECEIVED! Go to Room 205 and place them on the table."
    );
  }

  if (item.id === "teacherB") {
    startExamArrivalCountdown();
  }

  if (item.id === "teacherC") {
    showToast(
      "FAVOR ACCEPTED! Go to Room 206 and retrieve the office item."
    );
  }

  activeInteraction = null;

  $("interaction-screen").classList.add("hidden");
  $("interaction-extra").classList.add("hidden");

  standFromInteractionSeat();
  lockMouse();
});

    $("decline-favor").addEventListener("click", () => {
      activeInteraction = null;

      $("interaction-screen").classList.add("hidden");
      $("interaction-extra").classList.add("hidden");

      standFromInteractionSeat();
      lockMouse();

      showToast("FAVOR DECLINED. No penalty!");
    });
  }

  $("interaction-extra").classList.remove("hidden");
  $("interaction-screen").classList.remove("hidden");
}

function showCarriedDocuments() {

  // Remove old documents if they already exist.
  if (carriedDocuments) {
    camera.remove(carriedDocuments);
  }

  carriedDocuments = new THREE.Group();

  const paperMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f1df,
    roughness: 0.9
  });

  const lineMaterial = new THREE.MeshStandardMaterial({
    color: 0x667788,
    roughness: 1
  });

  // MAIN DOCUMENT
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(0.30, 0.40),
    paperMaterial
  );

  paper.position.z = 0;
  carriedDocuments.add(paper);

  // SECOND DOCUMENT
  const secondPaper = new THREE.Mesh(
    new THREE.PlaneGeometry(0.30, 0.40),
    paperMaterial
  );

  secondPaper.position.set(0.025, -0.015, -0.008);
  secondPaper.rotation.z = 0.08;
  carriedDocuments.add(secondPaper);

  // DOCUMENT LINES
  for (let i = 0; i < 5; i++) {

    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(0.19, 0.006),
      lineMaterial
    );

    line.position.set(
      -0.015,
      0.10 - i * 0.045,
      0.002
    );

    carriedDocuments.add(line);
  }

  // Position the documents in front of the player.
  carriedDocuments.position.set(
    0.38,
    -0.32,
    -0.85
  );

  carriedDocuments.rotation.set(
    -0.25,
    -0.15,
    -0.12
  );

  camera.add(carriedDocuments);
}

function giveTeacherReward(teacherId) {

  const rewards = ["time", "hint", "thanks"];

  const reward = rewards[
    Math.floor(Math.random() * rewards.length)
  ];

  favorRewards[teacherId] = reward;

  // REWARD 1 — EXTRA TIME
  if (reward === "time") {

    timeLeft += 30;

    updateHUD();

    showRewardPopup(
      "FAVOR COMPLETED!",
      "+30 SECONDS<br>Thank you for your help!"
    );
  }

  // REWARD 2 — GROUPMATE LOCATION HINT
  else if (reward === "hint") {

    const hints = {
      kristine: "Kristine is in Room 201, near the front classroom area.",
      enir: "Enir is in Room 202, the left-side middle room.",
      jio: "Jio is in Room 201, near the front classroom area.",
      rovelin: "Rovelin is in Room 204, the right-side front classroom."
    };

    const names = Object.keys(hints);

    const randomName = names[
      Math.floor(Math.random() * names.length)
    ];

    showRewardPopup(
      "TEACHER'S HINT!",
      hints[randomName]
    );
  }

  // REWARD 3 — THANK YOU ONLY
  else {

    showRewardPopup(
      "FAVOR COMPLETED!",
      "THANK YOU FOR YOUR HELP! I REALLY APPRECIATE IT!"
    );
  }
}

function startExamArrivalCountdown() {

  // Prevent duplicate countdowns.
  if (examArrivalInterval) {
    clearInterval(examArrivalInterval);
    examArrivalInterval = null;
  }

  if (watchExamInterval) return;

  examArrivalTimeLeft = 10;

  showToast(
    "HURRY! Reach Room 204 within 10 seconds!"
  );

  examArrivalInterval = setInterval(() => {

    if (!gameStarted || gamePaused || gameFinished) {
      return;
    }

    if (currentFloor === 2) {

      const distance = Math.hypot(
        camera.position.x - 7,
        camera.position.z - (-9)
      );

      // PLAYER REACHED ROOM 204
      if (distance <= 2.65) {

        clearInterval(examArrivalInterval);
        examArrivalInterval = null;

        showToast(
          "YOU MADE IT! Watch the students for 30 seconds!"
        );

        startExamWatch({
          id: "room204Watch"
        });

        return;
      }
    }

    examArrivalTimeLeft--;

    if (examArrivalTimeLeft > 0) {

      showToast(
        `ROOM 204 DEADLINE: ${examArrivalTimeLeft} SECONDS LEFT!`
      );

    } else {

      clearInterval(examArrivalInterval);
      examArrivalInterval = null;

// FAVOR FAILED — RESET TEACHER B
acceptedFavors.delete("teacherB");

const teacherB = movingTeachers.find(
  teacher => teacher.id === "teacherB"
);

if (teacherB) {
  teacherB.stopped = false;
  teacherB.contactCooldown = 0;
}

showToast(
  "TIME'S UP! TEACHER B IS LOOKING FOR YOU AGAIN!"
);
    }

  }, 1000);
}

function showExamWatchHUD(time) {

  let display = document.getElementById("exam-watch-hud");

  if (!display) {

    display = document.createElement("div");
    display.id = "exam-watch-hud";

    display.innerHTML = `
      <div class="exam-watch-label">
        EXAMINATION WATCH
      </div>

      <div id="exam-watch-countdown">
        00:30
      </div>

      <div class="exam-watch-instruction">
        STAY INSIDE ROOM 204
      </div>
    `;

    document.body.appendChild(display);
  }

  const minutes = Math.floor(time / 60);
  const seconds = time % 60;

  document.getElementById("exam-watch-countdown").textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  display.classList.remove("hidden");
}


function hideExamWatchHUD() {

  const display = document.getElementById("exam-watch-hud");

  if (display) {
    display.classList.add("hidden");
  }
}

function openInteraction(item) {
  if (!item) return;

  // DOORS
  if (item.kind === "door") {
    toggleDoor(item.door);
    return;
  }

    // DECOY STUDENT — WRONG INTERACTION PENALTY
  if (item.kind === "decoy") {
    lives--;
    timeLeft = Math.max(0, timeLeft - 10);

    updateHUD();

    if (lives <= 0) {
      showToast("MISSION FAILED! NO LIVES LEFT.");
      finishGame(false);
      return;
    }

    if (timeLeft <= 0) {
      finishGame(false);
      return;
    }

    showToast("WRONG STUDENT! -1 LIFE AND -10 SECONDS.");
    return;
  }

  // TEACHERS
  if (item.kind === "teacher") {

    // Teacher C: Return the collected office item
    if (
      item.id === "teacherC" &&
      teacherCItemCollected &&
      acceptedFavors.has("teacherC") &&
      !completedFavors.has("teacherC")
    ) {
      activeInteraction = item;
      completeInteraction();
      return;
    }

    openTeacherInteraction(item);
    return;
  }


  // OPTIONAL FAVOR TARGETS
  if (item.kind === "favorTarget") {

    // TEACHER A — ROOM 205
    if (item.id === "room205Delivery") {
      if (!acceptedFavors.has("teacherA")) {
        showToast("Accept Teacher A's favor first!");
        return;
      }

      if (completedFavors.has("teacherA")) {
        showToast("You already delivered the documents!");
        return;
      }

      activeInteraction = item;
      completeInteraction();
      return;
    }

    // TEACHER B — ROOM 204
    if (item.id === "room204Watch") {
      if (!acceptedFavors.has("teacherB")) {
        showToast("Accept Teacher B's favor first!");
        return;
      }

      if (completedFavors.has("teacherB")) {
        showToast("You already completed the examination room watch!");
        return;
      }

      startExamWatch(item);
      return;
    }

    // TEACHER C — PICK UP OFFICE ITEM
    if (item.id === "teacherCItem") {
      if (!acceptedFavors.has("teacherC")) {
        showToast("Accept Teacher C's favor first!");
        return;
      }

      if (completedFavors.has("teacherC")) {
        showToast("You already completed Teacher C's favor!");
        return;
      }

      if (teacherCItemCollected) {
        showToast("You already picked up the item. Return it to Teacher C!");
        return;
      }

      activeInteraction = item;
      completeInteraction();
      return;
    }
  }


  // REGULAR MISSION TASKS
  if (completedTasks.has(item.id)) {
    showToast("You already completed this task.");
    return;
  }

  activeInteraction = item;

  if (item.kind !== "npc") {
    sitAtInteractionSeat(item);
  }
  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }

  pointerLocked = false;
  document.body.classList.add("cursor-visible");

  challengeIndex = 0;
  challengeCorrect = 0;
  challengeAnswered = false;

  const objectiveNumber = getObjectiveNumber(item);
  const difficulty = getObjectiveDifficulty(item);

  $("interaction-category").textContent =
    `FLOOR ${item.floor} • OBJECTIVE ${objectiveNumber} • ${difficulty}`;

  $("interaction-title").textContent = item.title;

  $("interaction-description").textContent =
    taskDescriptions[item.kind] || item.description;

  $("interaction-screen").classList.remove("hidden");
  $("interaction-extra").classList.remove("hidden");

  // GROUPMATE CONTRIBUTION — NO QUIZ REQUIRED
  if (item.kind === "npc") {
    const extra = $("interaction-extra");

    extra.innerHTML = `
      <button
        type="button"
        class="challenge-next"
        id="collect-contribution"
      >
        COLLECT CONTRIBUTION
      </button>
    `;

    extra.classList.remove("hidden");

    $("collect-contribution").addEventListener("click", () => {
      completeInteraction();
    });

    return;
  }

  renderChallenge();
}


function startExamWatch(item) {

  // CHECK IF FAVOR WAS ACCEPTED
  if (!acceptedFavors.has("teacherB")) {
    showToast("Accept Teacher B's favor first!");
    return;
  }

  // CHECK IF ALREADY COMPLETED
  if (completedFavors.has("teacherB")) {
    showToast("You already completed the examination watch!");
    return;
  }

  // PREVENT DUPLICATE TIMER
  if (watchExamInterval) {
    showToast("You are already watching the examination room!");
    return;
  }

  watchExamTimeLeft = 30;
  showExamWatchHUD(watchExamTimeLeft);

  activeInteraction = null;

  $("interaction-screen").classList.add("hidden");
  $("interaction-extra").classList.add("hidden");

  standFromInteractionSeat();
  lockMouse();

  showToast(
    "EXAMINATION WATCH STARTED! Stay inside Room 204 for 30 seconds."
  );

  watchExamInterval = setInterval(() => {

    if (!gameStarted || gamePaused || gameFinished) {
      return;
    }

    // CHECK IF PLAYER IS STILL INSIDE ROOM 204
    const distance = Math.hypot(
      camera.position.x - 7,
      camera.position.z - (-9)
    );

    if (distance > 2.65) {
      clearInterval(watchExamInterval);
      watchExamInterval = null;

      watchExamTimeLeft = 30;

      showToast(
        "EXAMINATION WATCH CANCELLED! Stay inside Room 204."
      );

      return;
    }

    // COUNTDOWN
    watchExamTimeLeft--;
    showExamWatchHUD(watchExamTimeLeft);
    hideExamWatchHUD();

    if (
      watchExamTimeLeft > 0 &&
      watchExamTimeLeft % 5 === 0
    ) {
      showToast(
        `EXAMINATION WATCH: ${watchExamTimeLeft} SECONDS LEFT`
      );
    }

    // COMPLETED
    if (watchExamTimeLeft <= 0) {
      clearInterval(watchExamInterval);
      watchExamInterval = null;

      completedFavors.add("teacherB");

      startTeacherChaseCooldown("teacherB");

      removeCompletedTeacher("teacherB");

      giveTeacherReward("teacherB");

      updateHUD();

      showToast(
        "EXAMINATION WATCH COMPLETED! Thank you for helping!"
      );
    }

  }, 1000);
}

function showRewardPopup(title, message) {

  let popup = document.getElementById("teacher-reward-popup");

  if (!popup) {

    popup = document.createElement("div");
    popup.id = "teacher-reward-popup";

    document.body.appendChild(popup);
  }

  popup.innerHTML = `
    <div class="reward-card">
      <div class="reward-icon">★</div>

      <h2>${title}</h2>

      <p>${message}</p>

      <button id="reward-close-button">
        CONTINUE
      </button>
    </div>
  `;

  popup.classList.remove("hidden");

  document.getElementById("reward-close-button")
    .addEventListener("click", () => {
      popup.classList.add("hidden");
    });
}

// ============================================================
// RENDER CHALLENGES
// ============================================================

function renderChallenge() {
  if (!activeInteraction) return;

  const container = $("interaction-extra");
  container.innerHTML = "";

  const objectiveNumber = getObjectiveNumber(activeInteraction);

  if (activeInteraction.id === "diagnostic") {
    renderWirePuzzle(container);
    return;
  }

  const challenge =
    challengeBank[activeInteraction.kind][challengeIndex];

  const difficulty =
    objectiveNumber === 1 ? "EASY" : "MEDIUM";

  const progress = document.createElement("p");
  progress.className = "challenge-progress";
  progress.textContent =
    `OBJECTIVE ${objectiveNumber} • ${difficulty} • QUESTION ${challengeIndex + 1} OF 3`;

  container.appendChild(progress);

  const question = document.createElement("h3");
  question.className = "challenge-question";
  question.textContent = challenge[0];

  container.appendChild(question);

  const options = document.createElement("div");
  options.className = "challenge-options";

  challenge[1].forEach((option, index) => {
    const button = document.createElement("button");

    button.className = "challenge-option";
    button.textContent = option;
    button.type = "button";

    button.addEventListener("click", () => {
      if (challengeAnswered) return;

      challengeAnswered = true;

      const correct = index === challenge[2];

      if (correct) {
        challengeCorrect++;
      }

      button.classList.add(
        correct ? "correct" : "incorrect"
      );

      Array.from(options.children).forEach((optionButton, i) => {
        optionButton.disabled = true;

        if (i === challenge[2]) {
          optionButton.classList.add("correct");
        }
      });

      const feedback = document.createElement("p");
      feedback.className = "challenge-feedback";

      feedback.textContent = correct
        ? "Correct! Good job."
        : `Incorrect. Correct answer: ${challenge[1][challenge[2]]}`;

      container.appendChild(feedback);

      const next = document.createElement("button");
      next.className = "challenge-next";

      next.textContent =
        challengeIndex === 2
          ? "FINISH OBJECTIVE"
          : "NEXT QUESTION";

      next.addEventListener("click", () => {
        if (challengeIndex < 2) {
          challengeIndex++;
          challengeAnswered = false;
          renderChallenge();
        } else {
          finishChallenge();
        }
      });

      container.appendChild(next);
    });

    options.appendChild(button);
  });

  container.appendChild(options);
}

// ============================================================
// HARD WIRE PUZZLE
// ============================================================

function renderWirePuzzle(container) {
  const progress = document.createElement("p");

  progress.className = "challenge-progress";
  progress.textContent = "OBJECTIVE 3 OF 3 • HARD TASK";

  container.appendChild(progress);

  const title = document.createElement("h3");

  title.className = "challenge-question";
  title.textContent = "CONNECT THE COMPUTER WIRES";

  container.appendChild(title);

  const instruction = document.createElement("p");

  instruction.className = "challenge-feedback";

  instruction.textContent =
    "Select a colored cable on the left. Then connect it to the port with the SAME color on the right. Connect all four wires to restore the system.";

  container.appendChild(instruction);

  const colors = [
    { name: "RED", value: "#e34b4b" },
    { name: "BLUE", value: "#438bd4" },
    { name: "YELLOW", value: "#e5bd38" },
    { name: "GREEN", value: "#39a66b" }
  ];

  const ports = [
    colors[2],
    colors[0],
    colors[3],
    colors[1]
  ];

  const connected = new Set();

  let selectedCable = null;

  const board = document.createElement("div");

  board.style.display = "grid";
  board.style.gridTemplateColumns = "1fr 1fr";
  board.style.gap = "16px";
  board.style.margin = "18px 0";

  const cableColumn = document.createElement("div");
  const portColumn = document.createElement("div");

  const cableHeading = document.createElement("p");

  cableHeading.textContent = "COMPUTER CABLES";
  cableHeading.style.fontWeight = "700";

  cableColumn.appendChild(cableHeading);

  const portHeading = document.createElement("p");

  portHeading.textContent = "MOTHERBOARD PORTS";
  portHeading.style.fontWeight = "700";

  portColumn.appendChild(portHeading);

  const status = document.createElement("p");

  status.className = "challenge-feedback";
  status.textContent = "No cables connected yet.";

  const count = document.createElement("p");

  count.className = "challenge-progress";
  count.textContent = "CONNECTED: 0 / 4";

  function makeChoice(color, type) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "challenge-option";

    button.textContent =
      type === "cable"
        ? `${color.name} CABLE`
        : `${color.name} PORT`;

    button.style.display = "block";
    button.style.width = "100%";
    button.style.margin = "8px 0";
    button.style.border = `3px solid ${color.value}`;
    button.style.borderRadius = "8px";

    button.addEventListener("click", () => {
      if (connected.has(color.name)) return;

      if (type === "cable") {
        selectedCable = color.name;

        status.textContent =
          `${color.name} cable selected. Choose the matching port.`;

        cableColumn.querySelectorAll("button").forEach(b => {
          b.style.outline =
            b === button ? "3px solid #f4d58d" : "none";
        });

        return;
      }

      if (!selectedCable) {
        status.textContent = "Select a cable first.";
        return;
      }

      if (selectedCable !== color.name) {
        status.textContent =
          "Incorrect connection! The cable color does not match the port. Try again.";

        selectedCable = null;

        cableColumn.querySelectorAll("button").forEach(b => {
          b.style.outline = "none";
        });

        return;
      }

      connected.add(color.name);
      selectedCable = null;

      status.textContent =
        `${color.name} cable connected successfully!`;

      count.textContent =
        `CONNECTED: ${connected.size} / 4`;

      cableColumn.querySelectorAll("button").forEach(b => {
        if (b.textContent.startsWith(color.name)) {
          b.disabled = true;
          b.style.opacity = "0.4";
          b.style.outline = "none";
        }
      });

      portColumn.querySelectorAll("button").forEach(b => {
        if (b.textContent.startsWith(color.name)) {
          b.disabled = true;
          b.style.opacity = "0.4";
        }
      });

      if (connected.size === 4) {
        status.textContent =
          "ALL FOUR WIRES CONNECTED! THE COMPUTER SYSTEM IS RESTORED!";

        const complete = document.createElement("button");

        complete.type = "button";
        complete.className = "challenge-next";
        complete.textContent = "COMPLETE HARD OBJECTIVE";

        complete.addEventListener("click", () => {
          challengeCorrect = 3;
          finishChallenge();
        });

        container.appendChild(complete);
      }
    });

    return button;
  }

  colors.forEach(color => {
    cableColumn.appendChild(
      makeChoice(color, "cable")
    );
  });

  ports.forEach(color => {
    portColumn.appendChild(
      makeChoice(color, "port")
    );
  });

  board.appendChild(cableColumn);
  board.appendChild(portColumn);

  container.appendChild(board);
  container.appendChild(count);
  container.appendChild(status);
}

// ============================================================
// FINISH CHALLENGE
// ============================================================

function finishChallenge() {
  const objectiveNumber = getObjectiveNumber(activeInteraction);

  const total = 3;
  const passed = challengeCorrect === total;

  const container = $("interaction-extra");

  container.innerHTML = "";

  const result = document.createElement("p");

  result.className = "challenge-finished";

  result.textContent = passed
    ? objectiveNumber === 3
      ? "HARD OBJECTIVE PASSED! All four colored wires are correctly connected."
      : `OBJECTIVE PASSED! You answered all ${total} questions correctly.`
    : `You answered ${challengeCorrect} out of ${total} correctly. Review the answers and try again.`;

  container.appendChild(result);

  const retryButton = document.createElement("button");

  retryButton.className = "challenge-next";

  retryButton.textContent = passed
    ? "CONFIRM OBJECTIVE COMPLETION"
    : "RETRY OBJECTIVE";

  retryButton.addEventListener("click", () => {
    if (passed) {
      completeInteraction();
    } else {
      challengeIndex = 0;
      challengeCorrect = 0;
      challengeAnswered = false;

      renderChallenge();
    }
  });

  container.appendChild(retryButton);
}

// ============================================================
// COMPLETE INTERACTION
// ============================================================

function completeInteraction() {
  if (!activeInteraction) return;

  const item = activeInteraction;

// TEACHER A — DOCUMENT DELIVERY
if (item.id === "room205Delivery") {

  if (!acceptedFavors.has("teacherA")) {
    showToast("Accept Teacher A's favor first!");
    return;
  }

  if (completedFavors.has("teacherA")) {
    showToast("You already delivered the documents!");
    return;
  }

  if (!carriedDocuments) {
    showToast("You need to bring Teacher A's documents!");
    return;
  }

  // Remove documents from player's view.
  camera.remove(carriedDocuments);
  carriedDocuments = null;

  // Complete Teacher A's favor.
  completedFavors.add("teacherA");

  startTeacherChaseCooldown("teacherA");

  removeCompletedTeacher("teacherA");

  giveTeacherReward("teacherA");

  activeInteraction = null;

  $("interaction-screen").classList.add("hidden");
  $("interaction-extra").classList.add("hidden");

  standFromInteractionSeat();
  lockMouse();

  showToast(
    "DOCUMENTS DELIVERED! Teacher A's favor completed!"
  );

  return;
}

  // TEACHER B — EXAMINATION ROOM WATCH
if (item.id === "room204Watch") {

  if (!acceptedFavors.has("teacherB")) {
    showToast("Accept Teacher B's favor first!");
    return;
  }

  if (watchExamInterval) {
    showToast("You are already watching the examination room!");
    return;
  }

  if (!examArrivalInterval) {
    startExamArrivalCountdown();
  } else {
    showToast("Reach Room 204 before the countdown ends!");
  }

  return;
}

  // TEACHER C — PICK UP OFFICE ITEM
if (item.id === "teacherCItem") {

  if (!acceptedFavors.has("teacherC")) {
    showToast("Accept Teacher C's favor first!");
    return;
  }

  if (teacherCItemCollected) {
    showToast("You already picked up the office item!");
    return;
  }

  teacherCItemCollected = true;

  showToast(
    "OFFICE ITEM COLLECTED! Return it to Teacher C."
  );

  activeInteraction = null;

  $("interaction-screen").classList.add("hidden");
  $("interaction-extra").classList.add("hidden");

  standFromInteractionSeat();
  lockMouse();

  return;
}

  // TEACHER C — RETURN OFFICE ITEM
if (item.kind === "teacher" && item.id === "teacherC") {

  if (!acceptedFavors.has("teacherC")) {
    showToast("Accept Teacher C's favor first!");
    return;
  }

  if (!teacherCItemCollected) {
    showToast("Find and collect the office item first!");
    return;
  }

  if (completedFavors.has("teacherC")) {
    return;
  }

  teacherCItemCollected = false;

  completedFavors.add("teacherC");

startTeacherChaseCooldown("teacherC");

  removeCompletedTeacher("teacherC");

  giveTeacherReward("teacherC");

  activeInteraction = null;

  $("interaction-screen").classList.add("hidden");
  $("interaction-extra").classList.add("hidden");

  standFromInteractionSeat();
  lockMouse();

  showToast(
    "OFFICE ITEM RETURNED! Teacher C's favor completed!"
  );

  return;
}

  // OTHER TEACHER FAVORS
  if (item.kind === "teacher") {

    if (!acceptedFavors.has(item.id)) return;

    if (completedFavors.has(item.id)) return;

    return;
  }

  // REGULAR MISSION TASKS
  if (completedTasks.has(item.id)) return;

  completedTasks.add(item.id);

  score += 150;

  standFromInteractionSeat();

  activeInteraction = null;

  $("interaction-screen").classList.add("hidden");

  updateHUD();

  if (item.kind === "submission") {
    finishGame(true);
    return;
  }

  const allDone = floorInfo[currentFloor].tasks.every(task =>
    completedTasks.has(task[1])
  );

  showToast(
    allDone
      ? "ALL OBJECTIVES COMPLETED! You may now walk downstairs."
      : "OBJECTIVE COMPLETED! +150 POINTS"
  );

  lockMouse();
}

// ============================================================
// STAIRS AND FLOOR TRANSITION
// ============================================================

function useStairs() {
  if (currentFloor === 1) {
    showToast("You are already on the first floor.");
    return;
  }

  showToast(
    "Walk down the staircase. Your unfinished tasks will remain saved."
  );
}

// ============================================================
// INTERACT
// ============================================================

function interact() {
  if (
    !gameStarted ||
    gamePaused ||
    gameFinished ||
    activeInteraction
  ) return;

  const item = nearestInteractable();

  if (item) {
    openInteraction(item);
    return;
  }

  if (isNearStairs()) {
    useStairs();
  }
}

// ============================================================
// DOOR ANIMATION
// ============================================================

function updateDoors(delta) {
  for (const door of doors) {
    const difference = door.target - door.angle;

    if (Math.abs(difference) > 0.01) {
      door.angle += difference * Math.min(1, delta * 7);

      door.group.rotation.y = door.angle;
    }
  }
}

// ============================================================
// MOUSE CURSOR
// ============================================================

function updateCursorVisibility() {
  pointerLocked =
    document.pointerLockElement === renderer.domElement;

  document.body.classList.toggle(
    "cursor-visible",
    !pointerLocked
  );
}

function lockMouse() {
  if (
    !gameStarted ||
    gamePaused ||
    gameFinished ||
    activeInteraction
  ) return;

  renderer.domElement.requestPointerLock?.();
}

function toggleMouseLock() {
  if (
    !gameStarted ||
    gamePaused ||
    gameFinished ||
    activeInteraction
  ) return;

  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  } else {
    renderer.domElement.requestPointerLock?.();
  }
}

renderer.domElement.addEventListener("click", () => {
  if (
    gameStarted &&
    !gamePaused &&
    !gameFinished &&
    !activeInteraction &&
    !pointerLocked
  ) {
    lockMouse();
  }
});

document.addEventListener(
  "pointerlockchange",
  updateCursorVisibility
);

document.addEventListener("mousemove", event => {
  if (
    !pointerLocked ||
    !gameStarted ||
    gamePaused ||
    activeInteraction
  ) return;

  yaw -= event.movementX * 0.0022;
  pitch -= event.movementY * 0.0022;

  pitch = THREE.MathUtils.clamp(
    pitch,
    -Math.PI / 2.5,
    Math.PI / 2.5
  );

  camera.rotation.set(pitch, yaw, 0);
});

// ============================================================
// GAME CONTROL
// ============================================================

function startGame() {

  score = 0;
  timeLeft = 510;
  lives = 3;

  completedTasks.clear();
  acceptedFavors.clear();
  completedFavors.clear();

  // RESET TEACHER CHASE SEQUENCE
  teacherChaseCooldown = 0;
  nextTeacherToChase = "teacherA";

  // Reset teacher rewards
  Object.keys(favorRewards).forEach(key => {
    delete favorRewards[key];
  });

  // Reset Teacher C item
  teacherCItemCollected = false;

  // Reset Teacher B watch timer
  watchExamTimeLeft = 30;

  if (watchExamInterval) {
    clearInterval(watchExamInterval);
    watchExamInterval = null;
  }

  if (examArrivalInterval) {
  clearInterval(examArrivalInterval);
  examArrivalInterval = null;
}

examArrivalTimeLeft = 10;

  currentFloor = 3;

  verticalVelocity = 0;
  isJumping = false;
  stairBlockedNotice = false;

  gameStarted = true;
  gamePaused = false;
  gameFinished = false;

  activeInteraction = null;

  yaw = Math.PI;
  pitch = 0;

  doors.forEach(door => {
    door.open = false;
    door.angle = 0;
    door.target = 0;

    door.group.rotation.y = 0;
  });

  $("menu-screen").classList.add("hidden");
  $("instructions-screen").classList.add("hidden");

  $("game-hud").classList.remove("hidden");
  $("interaction-screen").classList.add("hidden");

  $("pause-screen").classList.add("hidden");
  $("result-screen").classList.add("hidden");

  setPlayerFloor(3, 0, 4.8);

  camera.rotation.set(pitch, yaw, 0);

  updateHUD();

  showToast(
    "You are on the THIRD FLOOR. Find the rooms and complete your objectives."
  );

  clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    if (!gameStarted || gamePaused || gameFinished) return;

    timeLeft--;

    updateHUD();

    if (timeLeft <= 0) {
      finishGame(false);
    }
  }, 1000);

  lockMouse();
}

function finishGame(success) {
  gameFinished = true;
  gameStarted = false;
  gamePaused = false;

  clearInterval(timerInterval);

  if (watchExamInterval) {
    clearInterval(watchExamInterval);
    watchExamInterval = null;
  }

  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }

  pointerLocked = false;

  document.body.classList.add("cursor-visible");

  $("interaction-screen").classList.add("hidden");
  $("pause-screen").classList.add("hidden");
  $("game-hud").classList.add("hidden");

  $("result-screen").classList.remove("hidden");

  const gameOverReason = lives <= 0 ? "NO LIVES LEFT" : "TIME'S UP";

  $("result-label").textContent =
    success ? "MISSION COMPLETE" : gameOverReason;

  $("result-title").textContent =
    success ? "THESIS SUBMITTED!" : "DEADLINE MISSED";

  $("result-message").textContent =
    success
      ? "You completed all objectives and submitted your thesis before the deadline."
      : lives <= 0
        ? "You ran out of lives. Your mission has ended."
        : "The deadline has passed. You were unable to submit your thesis on time.";

  $("final-score").textContent =
    String(score).padStart(4, "0");
}

function pauseGame() {
  if (!gameStarted || gameFinished) return;

  gamePaused = true;

  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }

  $("pause-screen").classList.remove("hidden");
}

function resumeGame() {
  if (!gameStarted || gameFinished) return;

  gamePaused = false;

  $("pause-screen").classList.add("hidden");

  lockMouse();
}

function returnToMenu() {
  gameStarted = false;
  gamePaused = false;
  gameFinished = false;

  clearInterval(timerInterval);

    if (watchExamInterval) {
    clearInterval(watchExamInterval);
    watchExamInterval = null;
  }

  watchExamTimeLeft = 30;

  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }

  pointerLocked = false;

  document.body.classList.add("cursor-visible");

  $("game-hud").classList.add("hidden");
  $("pause-screen").classList.add("hidden");
  $("result-screen").classList.add("hidden");

  $("menu-screen").classList.remove("hidden");
}

// ============================================================
// BUTTON EVENTS
// ============================================================

$("start-button").addEventListener("click", startGame);

$("instructions-button").addEventListener("click", () => {
  $("menu-screen").classList.add("hidden");

  $("instructions-screen").classList.remove("hidden");
});

$("back-button").addEventListener("click", () => {
  $("instructions-screen").classList.add("hidden");

  $("menu-screen").classList.remove("hidden");
});

$("pause-button").addEventListener("click", pauseGame);

$("resume-button").addEventListener("click", resumeGame);

$("restart-button").addEventListener("click", startGame);

$("menu-button").addEventListener("click", returnToMenu);

$("play-again-button").addEventListener("click", startGame);

$("result-menu-button").addEventListener("click", returnToMenu);

$("close-interaction").addEventListener("click", () => {
  standFromInteractionSeat();

  activeInteraction = null;

  $("interaction-screen").classList.add("hidden");

  lockMouse();
});


// ============================================================
// MOBILE / TOUCH CONTROLS
// ============================================================

const mobileStyle = document.createElement("style");

mobileStyle.textContent = `
.mobile-controls {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 15;
  pointer-events: none;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.mobile-joystick {
  position: absolute;
  left: 24px;
  bottom: 28px;
  width: 132px;
  height: 132px;
  border-radius: 50%;
  background: rgba(30, 30, 30, 0.30);
  border: 2px solid rgba(255,255,255,0.65);
  pointer-events: auto;
  touch-action: none;
}

.mobile-stick {
  position: absolute;
  left: 39px;
  top: 39px;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: rgba(255,255,255,0.85);
  border: 2px solid rgba(60,60,60,0.5);
  box-shadow: 0 3px 10px rgba(0,0,0,0.3);
  pointer-events: none;
}

.mobile-actions {
  position: absolute;
  right: 22px;
  bottom: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 13px;
  pointer-events: auto;
}

.mobile-action-row {
  display: flex;
  gap: 12px;
}

.mobile-btn {
  width: 62px;
  height: 62px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.8);
  background: rgba(35,35,35,0.65);
  color: white;
  font-size: 12px;
  font-weight: 900;
  box-shadow: 0 3px 10px rgba(0,0,0,0.3);
  touch-action: none;
}

.mobile-btn:active {
  background: rgba(190,120,65,0.9);
  transform: scale(0.94);
}

.mobile-btn.interact {
  width: 72px;
  height: 72px;
  background: rgba(177,105,55,0.85);
}

.mobile-look-hint {
  position: absolute;
  right: 18px;
  bottom: 185px;
  color: white;
  background: rgba(0,0,0,0.35);
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 10px;
  pointer-events: none;
}

@media (pointer: coarse) {
  .mobile-controls {
    display: block;
  }
}

@media (max-width: 600px) {
  .mobile-joystick {
    width: 112px;
    height: 112px;
    left: 15px;
    bottom: 18px;
  }

  .mobile-stick {
    left: 31px;
    top: 31px;
  }

  .mobile-actions {
    right: 14px;
    bottom: 20px;
    gap: 9px;
  }

  .mobile-btn {
    width: 54px;
    height: 54px;
    font-size: 10px;
  }

  .mobile-btn.interact {
    width: 65px;
    height: 65px;
  }

  .mobile-look-hint {
    bottom: 165px;
    right: 12px;
  }
}
`;

document.head.appendChild(mobileStyle);

const mobileControls = document.createElement("div");
mobileControls.className = "mobile-controls";

mobileControls.innerHTML = `
  <div class="mobile-joystick" id="mobile-joystick">
    <div class="mobile-stick" id="mobile-stick"></div>
  </div>

  <div class="mobile-look-hint">
    SWIPE SCREEN TO LOOK
  </div>

  <div class="mobile-actions">
    <button class="mobile-btn interact" id="mobile-interact">
      INTERACT
    </button>

    <div class="mobile-action-row">
      <button class="mobile-btn" id="mobile-jump">
        JUMP
      </button>

      <button class="mobile-btn" id="mobile-pause">
        PAUSE
      </button>
    </div>
  </div>
`;

document.body.appendChild(mobileControls);

// Show controls only while actively playing
function updateMobileControls() {
  const isTouchDevice =
    window.matchMedia("(pointer: coarse)").matches ||
    navigator.maxTouchPoints > 0;

  mobileControls.style.display =
    isTouchDevice &&
    gameStarted &&
    !gamePaused &&
    !gameFinished &&
    !activeInteraction
      ? "block"
      : "none";
}

// JOYSTICK
const mobileJoystick = document.getElementById("mobile-joystick");
const mobileStick = document.getElementById("mobile-stick");

let joystickTouchId = null;
let joystickCenterX = 0;
let joystickCenterY = 0;

function resetMobileJoystick() {
  joystickTouchId = null;

  keys.w = false;
  keys.a = false;
  keys.s = false;
  keys.d = false;

  mobileStick.style.transform = "translate(0px, 0px)";
}

mobileJoystick.addEventListener("touchstart", event => {
  event.preventDefault();

  const touch = event.changedTouches[0];

  joystickTouchId = touch.identifier;

  const rect = mobileJoystick.getBoundingClientRect();

  joystickCenterX = rect.left + rect.width / 2;
  joystickCenterY = rect.top + rect.height / 2;

  updateJoystick(touch);
}, { passive: false });

mobileJoystick.addEventListener("touchmove", event => {
  event.preventDefault();

  for (const touch of event.changedTouches) {
    if (touch.identifier === joystickTouchId) {
      updateJoystick(touch);
    }
  }
}, { passive: false });

mobileJoystick.addEventListener("touchend", event => {
  for (const touch of event.changedTouches) {
    if (touch.identifier === joystickTouchId) {
      resetMobileJoystick();
    }
  }
});

mobileJoystick.addEventListener("touchcancel", resetMobileJoystick);

function updateJoystick(touch) {
  const dx = touch.clientX - joystickCenterX;
  const dy = touch.clientY - joystickCenterY;

  const maxDistance = 38;
  const distance = Math.hypot(dx, dy);
  const scale = distance > maxDistance
    ? maxDistance / distance
    : 1;

  const limitedX = dx * scale;
  const limitedY = dy * scale;

  mobileStick.style.transform =
    `translate(${limitedX}px, ${limitedY}px)`;

  keys.w = limitedY < -12;
  keys.s = limitedY > 12;
  keys.a = limitedX < -12;
  keys.d = limitedX > 12;
}

// LOOK AROUND BY SWIPING THE GAME SCREEN
let lookTouchId = null;
let lastLookX = 0;
let lastLookY = 0;

renderer.domElement.addEventListener("touchstart", event => {
  if (
    !gameStarted ||
    gamePaused ||
    gameFinished ||
    activeInteraction
  ) return;

  for (const touch of event.changedTouches) {
    lookTouchId = touch.identifier;
    lastLookX = touch.clientX;
    lastLookY = touch.clientY;
    break;
  }
}, { passive: true });

renderer.domElement.addEventListener("touchmove", event => {
  if (
    lookTouchId === null ||
    !gameStarted ||
    gamePaused ||
    gameFinished ||
    activeInteraction
  ) return;

  for (const touch of event.changedTouches) {
    if (touch.identifier !== lookTouchId) continue;

    const dx = touch.clientX - lastLookX;
    const dy = touch.clientY - lastLookY;

    yaw -= dx * 0.006;
    pitch -= dy * 0.006;

    pitch = THREE.MathUtils.clamp(
      pitch,
      -Math.PI / 2.5,
      Math.PI / 2.5
    );

    camera.rotation.set(pitch, yaw, 0);

    lastLookX = touch.clientX;
    lastLookY = touch.clientY;
  }
}, { passive: true });

function endMobileLook(event) {
  for (const touch of event.changedTouches) {
    if (touch.identifier === lookTouchId) {
      lookTouchId = null;
    }
  }
}

renderer.domElement.addEventListener("touchend", endMobileLook);
renderer.domElement.addEventListener("touchcancel", endMobileLook);

// MOBILE JUMP
document.getElementById("mobile-jump")
  .addEventListener("touchstart", event => {
    event.preventDefault();
    jump();
  }, { passive: false });

// MOBILE INTERACT
document.getElementById("mobile-interact")
  .addEventListener("touchstart", event => {
    event.preventDefault();
    interact();
  }, { passive: false });

// MOBILE PAUSE
document.getElementById("mobile-pause")
  .addEventListener("touchstart", event => {
    event.preventDefault();
    pauseGame();
  }, { passive: false });


// ============================================================
// KEYBOARD CONTROLS
// ============================================================

window.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();

  if (key === "shift") {
    event.preventDefault();

    if (!event.repeat) {
      toggleMouseLock();
    }

    return;
  }

  keys[key] = true;

  if (
    [
      "w",
      "a",
      "s",
      "d",
      "arrowup",
      "arrowdown",
      "arrowleft",
      "arrowright",
      " "
    ].includes(key)
  ) {
    event.preventDefault();
  }

  if (key === "e") {
    interact();
  }

  if (key === " ") {
    jump();
  }

  if (key === "escape" && pointerLocked) {
    pauseGame();
  }
});

window.addEventListener("keyup", event => {
  keys[event.key.toLowerCase()] = false;
});

window.addEventListener("blur", () => {
  Object.keys(keys).forEach(key => {
    keys[key] = false;
  });
});

// ============================================================
// ANIMATION
// ============================================================


function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  movePlayer(delta);

  updateMobileControls();

updateDoors(delta);
updateAmbientNPCs(delta);
updateMovingTeachers(delta);
updateExamStudents(delta);
updateTeacherHitEffect(delta);
updatePrompt();

  renderer.render(scene, camera);
}

animate();


// ============================================================
// RESIZE
// ============================================================

window.addEventListener("resize", () => {
  camera.aspect =
    window.innerWidth / window.innerHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );

  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, 1.25)
  );
});

// ============================================================
// INITIALIZATION
// ============================================================

setPlayerFloor(3, 0, 4.8);

yaw = Math.PI;

camera.rotation.set(0, yaw, 0);

updateHUD();

document.body.classList.add("cursor-visible");

$("loading-screen").classList.add("hidden");

console.log("The Last Submission loaded.");
console.log("Three-floor school environment ready.");
console.log("Faculty rooms enhanced.");
console.log("Computer laboratories reorganized.");
console.log("Furniture collision enabled.");
console.log("Inside and outside door knobs ready.");
console.log("Easy, medium, and hard objectives ready.");
console.log("Four-color wire puzzle ready.");
console.log("Staircase and floor progression ready.");
console.log("Mouse cursor toggle ready.");