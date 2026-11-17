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

let playerPosition = new THREE.Vector3(0, PLAYER_HEIGHT, 4.8);

let yaw = Math.PI;
let pitch = 0;

let gameStarted = false;
let gamePaused = false;
let gameFinished = false;
let pointerLocked = false;

let score = 0;
let timeLeft = 300;

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

const keys = {};
const colliders = [];
const interactables = [];
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

function makeNPC(x, baseY, z, shirtColor = 0x536c82) {
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.27, 0.34, 0.9, 16),
    mat(shirtColor)
  );

  body.position.set(x, baseY + 0.98, z);
  body.castShadow = true;

  scene.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.23, 18, 18),
    M.skin
  );

  head.position.set(x, baseY + 1.62, z);
  scene.add(head);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(
      0.24,
      18,
      12,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2
    ),
    M.hair
  );

  hair.position.set(x, baseY + 1.71, z);
  scene.add(hair);

  addCollider(x, z, 0.65, 0.65);
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
    id: `door-side-{z}`,
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
    description: "Find your groupmates and collect the missing research documents.",

    tasks: [
      ["Get the first groupmate's contribution", "groupmate1"],
      ["Get the second groupmate's contribution", "groupmate2"],
      ["Organize the final thesis document", "thesis"]
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


    // ROOM 202 — GROUP STUDY ROOM

    makeWhiteboard(7.0, baseY, -14.7);

    makeDesk(5.5, baseY, -10.5, 1.5);
    makeChair(5.5, baseY, -9.25, 0x547b83);

    makeDesk(8.3, baseY, -10.5, 1.5);
    makeChair(8.3, baseY, -9.25, 0x826a91);

    makeDesk(5.5, baseY, -5.6, 1.5);
    makeChair(5.5, baseY, -4.35);

    makeDesk(8.3, baseY, -5.6, 1.5);
    makeChair(8.3, baseY, -4.35);

    makeBookshelf(9.0, baseY, -13.1);
    makePlant(5.0, baseY, -13.1);

    makeNPC(-6.2, baseY, -7.0, 0x547b83);
    makeNPC(6.2, baseY, -7.0, 0x826a91);

    addInteractable(
      2, -6.2, -7.0,
      "FIRST GROUPMATE",
      "Your first groupmate has the research background and related literature section.",
      "groupmate1", "npc"
    );

    addInteractable(
      2, 6.2, -7.0,
      "SECOND GROUPMATE",
      "Your second groupmate has the methodology and data gathering notes.",
      "groupmate2", "npc"
    );


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

    addInteractable(
      2, 6.2, 2.8,
      "THESIS DOCUMENT",
      "A folder with the group's final research files is on the study table.",
      "thesis", "document"
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
    `${String(seconds).padStart(2, "0")}`;

  $("score").textContent = String(score).padStart(4, "0");

  const suffix =
    currentFloor === 3 ? "RD" :
    currentFloor === 2 ? "ND" : "ST";

  $("floor-display").textContent =
    `${suffix} FLOOR`;

  const info = floorInfo[currentFloor];

  $("location-name").textContent = info.name;
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

  $("progress-fill").style.width =
    `${count / 3 * 100}%`;
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

function openInteraction(item) {
  if (!item) return;

  if (item.kind === "door") {
    toggleDoor(item.door);
    return;
  }

  if (completedTasks.has(item.id)) {
    showToast("You already completed this task.");
    return;
  }

  activeInteraction = item;

  sitAtInteractionSeat(item);

if (document.pointerLockElement === renderer.domElement) {
  document.exitPointerLock();
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

  renderChallenge();
}

// ============================================================
// RENDER CHALLENGES
// ============================================================

function renderChallenge() {
  if (!activeInteraction) return;

  const container = $("interaction-extra");
  container.innerHTML = "";

  const objectiveNumber = getObjectiveNumber(activeInteraction);

  if (objectiveNumber === 3) {
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
  completedTasks.clear();

  score = 0;
  timeLeft = 300;

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

  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }

  pointerLocked = false;

  document.body.classList.add("cursor-visible");

  $("interaction-screen").classList.add("hidden");
  $("pause-screen").classList.add("hidden");
  $("game-hud").classList.add("hidden");

  $("result-screen").classList.remove("hidden");

  $("result-label").textContent =
    success ? "MISSION COMPLETE" : "TIME'S UP";

  $("result-title").textContent =
    success ? "THESIS SUBMITTED!" : "DEADLINE MISSED";

  $("result-message").textContent =
    success
      ? "You completed all nine objectives and submitted your thesis before the deadline."
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

  updateDoors(delta);

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