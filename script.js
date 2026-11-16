
/* =========================================
   THE LAST SUBMISSION
   3D FIRST-PERSON SCHOOL EXPLORATION
========================================= */

const world = document.getElementById("game-world");

if (!window.THREE) {
  document.getElementById("loading-screen").innerHTML =
    "<div class='loading-card'><p>Unable to load the 3D engine. Check your internet connection and refresh.</p></div>";
  throw new Error("Three.js could not be loaded.");
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb9c9ce);
scene.fog = new THREE.Fog(0xb9c9ce, 24, 65);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);

camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({
  antialias: true
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

world.appendChild(renderer.domElement);

/* =========================================
   GAME VARIABLES
========================================= */

const PLAYER_HEIGHT = 1.65;
const PLAYER_RADIUS = 0.3;
const FLOOR_HEIGHT = 4;

let currentFloor = 3;
let playerPosition = new THREE.Vector3(0, PLAYER_HEIGHT, 11);
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
let toastTimeout = null;

const keys = {};
const colliders = [];
const interactables = [];
const completedTasks = new Set();

const clock = new THREE.Clock();

/* =========================================
   MATERIALS
========================================= */

function material(color, roughness = 0.85, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    ...extra
  });
}

const M = {
  wall: material(0xe7e1d7),
  wallDark: material(0xcac2b5),
  floor: material(0xb5a58f),
  ceiling: material(0xf0eee8),
  wood: material(0x926d4b),
  woodLight: material(0xb38d65),
  metal: material(0x626e72, 0.45, { metalness: 0.5 }),
  black: material(0x242b2e, 0.5),
  screen: material(0x75969a, 0.35, {
    emissive: 0x243e43,
    emissiveIntensity: 0.7
  }),
  glass: material(0x9ebfc9, 0.2, {
    transparent: true,
    opacity: 0.65
  }),
  white: material(0xf4f0e7),
  green: material(0x587d62),
  orange: material(0xb97848),
  skin: material(0xc89574),
  hair: material(0x30251f)
};

/* =========================================
   LIGHTING
========================================= */

scene.add(
  new THREE.HemisphereLight(0xe8f0ff, 0x74604b, 1.5)
);

const sunlight = new THREE.DirectionalLight(0xffe7c7, 2.0);
sunlight.position.set(-10, 18, 8);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(1024, 1024);
scene.add(sunlight);

function addRoomLight(x, y, z) {
  const light = new THREE.PointLight(0xffedcf, 24, 12);
  light.position.set(x, y, z);
  scene.add(light);

  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.06, 0.35),
    M.white
  );

  lamp.position.set(x, y - 0.12, z);
  scene.add(lamp);
}

/* =========================================
   OBJECT HELPERS
========================================= */

function addBox(w, h, d, mat, x, y, z, collisionFloor = null) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    mat
  );

  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  scene.add(mesh);

  if (collisionFloor !== null) {
    colliders.push({
      floor: collisionFloor,
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2
    });
  }

  return mesh;
}

function addWall(w, h, d, x, y, z, floor) {
  return addBox(w, h, d, M.wall, x, y, z, floor);
}

function addSign(text, x, y, z, rotation = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;

  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#eee9df";
  ctx.fillRect(0, 0, 512, 128);

  ctx.fillStyle = "#403d37";
  ctx.font = "bold 36px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.6),
    new THREE.MeshBasicMaterial({ map: texture })
  );

  sign.position.set(x, y, z);
  sign.rotation.y = rotation;
  scene.add(sign);
}

function addWindow(x, y, z, rotation = 0) {
  const windowMesh = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 1.4, 0.08),
    M.glass
  );

  windowMesh.position.set(x, y, z);
  windowMesh.rotation.y = rotation;
  scene.add(windowMesh);

  const frameMat = M.white;

  if (Math.abs(rotation) < 0.1) {
    addBox(2.15, 0.08, 0.12, frameMat, x, y, z);
    addBox(0.08, 1.5, 0.12, frameMat, x - 1, y, z);
    addBox(0.08, 1.5, 0.12, frameMat, x + 1, y, z);
  } else {
    addBox(0.12, 0.08, 2.15, frameMat, x, y, z);
    addBox(0.12, 1.5, 0.08, frameMat, x, y, z - 1);
    addBox(0.12, 1.5, 0.08, frameMat, x, y, z + 1);
  }
}

/* =========================================
   FURNITURE
========================================= */

function makeDesk(x, y, z) {
  addBox(2, 0.14, 1, M.wood, x, y + 0.8, z);

  for (const dx of [-0.85, 0.85]) {
    for (const dz of [-0.35, 0.35]) {
      addBox(0.1, 0.78, 0.1, M.metal, x + dx, y + 0.39, z + dz);
    }
  }
}

function makeChair(x, y, z) {
  addBox(0.65, 0.12, 0.62, M.green, x, y + 0.48, z);
  addBox(0.65, 0.65, 0.12, M.green, x, y + 0.82, z + 0.24);

  for (const dx of [-0.23, 0.23]) {
    for (const dz of [-0.2, 0.2]) {
      addBox(0.06, 0.46, 0.06, M.metal, x + dx, y + 0.23, z + dz);
    }
  }
}

function makeComputer(x, y, z) {
  makeDesk(x, y, z);

  addBox(0.95, 0.62, 0.12, M.black, x, y + 1.24, z - 0.2);
  addBox(0.82, 0.48, 0.025, M.screen, x, y + 1.24, z - 0.125);
  addBox(0.12, 0.25, 0.12, M.metal, x, y + 0.86, z - 0.2);
  addBox(0.65, 0.04, 0.32, M.black, x, y + 0.89, z + 0.13);
  addBox(0.3, 0.53, 0.4, M.metal, x + 0.72, y + 1.08, z - 0.12);

  makeChair(x, y, z + 1.05);
}

function makePrinter(x, y, z) {
  addBox(1.1, 0.62, 0.8, M.white, x, y + 0.65, z);
  addBox(0.72, 0.06, 0.48, M.black, x, y + 1, z - 0.05);
  addBox(0.6, 0.035, 0.4, M.white, x, y + 1.04, z + 0.13);
  addBox(0.45, 0.02, 0.32, M.white, x, y + 1.01, z + 0.12);
}

function makeNPC(x, y, z, shirtColor = 0x536c82) {
  const shirt = material(shirtColor);
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.27, 0.33, 0.9, 14),
    shirt
  );

  body.position.set(x, y + 0.95, z);
  body.castShadow = true;
  scene.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.23, 16, 16),
    M.skin
  );

  head.position.set(x, y + 1.58, z);
  head.castShadow = true;
  scene.add(head);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    M.hair
  );

  hair.position.set(x, y + 1.68, z);
  scene.add(hair);

  addBox(0.12, 0.48, 0.13, M.skin, x - 0.34, y + 0.92, z);
  addBox(0.12, 0.48, 0.13, M.skin, x + 0.34, y + 0.92, z);
}

/* =========================================
   FLOOR AND ROOM LAYOUT
========================================= */

const roomLabels = {
  3: ["COMPUTER LAB 301", "CLASSROOM 302", "FACULTY ROOM 303"],
  2: ["CLASSROOM 201", "GROUP STUDY ROOM 202", "FACULTY ROOM 203"],
  1: ["PRINTING ROOM 101", "LOBBY", "SUBMISSION OFFICE"]
};

const floorInfo = {
  3: {
    name: "THIRD FLOOR",
    description: "Fix the computer problems and prepare your thesis files.",
    tasks: [
      ["Fix the frozen computer", "computer"],
      ["Restore the internet", "router"],
      ["Complete the system check", "diagnostic"]
    ]
  },
  2: {
    name: "SECOND FLOOR",
    description: "Find your groupmates and collect the missing thesis files.",
    tasks: [
      ["Find your first groupmate", "groupmate1"],
      ["Talk to your second groupmate", "groupmate2"],
      ["Collect the final thesis file", "thesis"]
    ]
  },
  1: {
    name: "FIRST FLOOR",
    description: "Print, bind, and submit your thesis before the deadline.",
    tasks: [
      ["Print the thesis", "printer"],
      ["Bind the documents", "binding"],
      ["Submit the final thesis", "submission"]
    ]
  }
};

function buildFloor(level) {
  const y = (3 - level) * FLOOR_HEIGHT;
  const floor = level;

  // Hallway and room floors
  addBox(20, 0.2, 30, M.floor, 0, y - 0.12, 0);
  addBox(20, 0.18, 30, M.ceiling, 0, y + 3.55, 0);

  // Side walls with three doorway gaps
  const centers = [-8, 0, 8];
  const gap = 2.1;

  for (const side of [-1, 1]) {
    const wallX = side * 4;

    for (const center of centers) {
      const firstLength = 4 - gap / 2;
      const secondLength = 4 - gap / 2;

      addWall(
        0.2, 3.5, firstLength,
        wallX, y + 1.65,
        center - 2 - firstLength / 2, floor
      );

      addWall(
        0.2, 3.5, secondLength,
        wallX, y + 1.65,
        center + 2 + secondLength / 2, floor
      );

      // Door frames
      addBox(0.17, 2.35, 0.15, M.woodLight, wallX, y + 1.17, center - 1.02);
      addBox(0.17, 2.35, 0.15, M.woodLight, wallX, y + 1.17, center + 1.02);
      addBox(0.17, 0.16, 2.2, M.woodLight, wallX, y + 2.32, center);
    }

    // Outer side wall
    addWall(0.25, 3.5, 30, side * 10, y + 1.65, 0, floor);

    // Room dividers
    for (const z of [-4, 4]) {
      addWall(6, 3.5, 0.2, side * 7, y + 1.65, z, floor);
    }

    // Windows in room outer walls
    for (const z of [-8, 0, 8]) {
      addWindow(side * 9.85, y + 2.15, z, Math.PI / 2);
    }
  }

  // End walls
  addWall(20, 3.5, 0.2, 0, y + 1.65, -15, floor);
  addWall(20, 3.5, 0.2, 0, y + 1.65, 15, floor);

  // Staircase area at the end of the hall
  for (let i = 0; i < 5; i++) {
    addBox(
      1.8,
      0.2 + i * 0.13,
      0.65,
      M.woodLight,
      0,
      y + 0.1 + i * 0.13,
      12 + i * 0.42
    );
  }

  addSign("STAIRS", 0, y + 2.7, 14.65);

  // Ceiling lights
  for (const x of [-6, 0, 6]) {
    for (const z of [-8, 0, 8]) {
      addRoomLight(x, y + 3.3, z);
    }
  }

  // Room signs
  for (let i = 0; i < 3; i++) {
    addSign(roomLabels[level][i], -3.82, y + 2.65, centers[i], Math.PI / 2);
    addSign(roomLabels[level][i], 3.82, y + 2.65, centers[i], -Math.PI / 2);
  }

  buildFloorFurniture(level, y);
}

/* =========================================
   INTERACTABLE OBJECTS
========================================= */

function addInteractable(floor, x, z, title, description, detail, id, kind) {
  interactables.push({
    floor,
    x,
    z,
    title,
    description,
    detail,
    id,
    kind
  });
}

function buildFloorFurniture(level, y) {

  if (level === 3) {
    // Computer lab on the left side
    makeComputer(-6, y, -8);
    makeComputer(-6, y, 0);
    makeComputer(-6, y, 8);

    // Classroom furniture on right side
    makeDesk(6, y, -8);
    makeChair(6, y, -6.8);
    makeDesk(6, y, 0);
    makeChair(6, y, 1.2);

    addInteractable(
      3, -6, -8,
      "FROZEN COMPUTER",
      "The computer is frozen. Your thesis document is still open.",
      "Restart the unresponsive application safely to recover your work.",
      "computer", "computer"
    );

    addBox(0.65, 0.16, 0.35, M.white, 6, y + 1.05, -8);

    for (let i = 0; i < 4; i++) {
      addBox(0.04, 0.38, 0.04, M.black, 5.78 + i * 0.12, y + 1.3, -8);
    }

    addInteractable(
      3, 6, -8,
      "NETWORK ROUTER",
      "The computer laboratory has lost its internet connection.",
      "Check the router and restore the network connection.",
      "router", "router"
    );

    addInteractable(
      3, -6, 0,
      "SYSTEM DIAGNOSTIC",
      "The workstation needs a final system check.",
      "Check the system and make sure your thesis file is safe.",
      "diagnostic", "diagnostic"
    );
  }

  if (level === 2) {
    // Classroom and study room
    for (const z of [-8, -5, -2]) {
      makeDesk(-6, y, z);
      makeChair(-6, y, z + 1);
    }

    makeDesk(6, y, -8);
    makeDesk(6, y, 0);
    makeDesk(6, y, 8);

    makeNPC(-6, y, -5.7, 0x547b83);
    makeNPC(6, y, -5.7, 0x826a91);

    addInteractable(
      2, -6, -5.7,
      "FIRST GROUPMATE",
      "Your first groupmate is waiting inside the classroom.",
      "Talk to your groupmate to receive their assigned research section.",
      "groupmate1", "npc"
    );

    addInteractable(
      2, 6, -5.7,
      "SECOND GROUPMATE",
      "Your second groupmate has an update about the thesis.",
      "Collect the remaining research content from your groupmate.",
      "groupmate2", "npc"
    );

    addInteractable(
      2, 6, 8,
      "THESIS DOCUMENT",
      "A folder containing the final thesis document is on the desk.",
      "Collect the document and bring it to the printing room.",
      "thesis", "document"
    );
  }

  if (level === 1) {
    // Ground floor
    makePrinter(-6, y, -8);
    makeDesk(6, y, -8);
    makeDesk(-6, y, 0);
    makeNPC(6, y, -6, 0x52665c);

    addInteractable(
      1, -6, -8,
      "PRINTING MACHINE",
      "The thesis document is ready to be printed.",
      "Prepare and print all the pages of your thesis.",
      "printer", "printer"
    );

    addInteractable(
      1, 6, -8,
      "BINDING STATION",
      "The printed thesis pages need to be arranged and bound.",
      "Arrange the pages properly and finish the binding process.",
      "binding", "binding"
    );

    addInteractable(
      1, -6, 0,
      "FINAL SUBMISSION OFFICE",
      "This is the final destination for your thesis.",
      "Submit your completed thesis to finish the mission.",
      "submission", "submission"
    );
  }
}

buildFloor(3);
buildFloor(2);
buildFloor(1);

/* =========================================
   PLAYER POSITION AND CAMERA
========================================= */

function setPlayerFloor(floor, x = 0, z = 11) {
  currentFloor = floor;
  playerPosition.set(x, (3 - floor) * FLOOR_HEIGHT + PLAYER_HEIGHT, z);
  camera.position.copy(playerPosition);
  updateHUD();
}

camera.position.copy(playerPosition);

/* =========================================
   UI HELPERS
========================================= */

const $ = id => document.getElementById(id);

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2400);
}

function updateHUD() {
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  $("timer").textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  $("score").textContent = String(score).padStart(4, "0");

  const suffix = currentFloor === 3 ? "RD" : currentFloor === 2 ? "ND" : "ST";
  $("floor-display").textContent = `${currentFloor}${suffix} FLOOR`;

  const info = floorInfo[currentFloor];

  $("location-name").textContent = info.name;
  $("floor-description").textContent = info.description;

  const doneCount = info.tasks.filter(task =>
    completedTasks.has(`${currentFloor}-${task[1]}`)
  ).length;

  $("progress-text").textContent = `${doneCount} / ${info.tasks.length}`;
  $("progress-fill").style.width =
    `${doneCount / info.tasks.length * 100}%`;

  $("objective-list").innerHTML = "";

  info.tasks.forEach(([label, id]) => {
    const done = completedTasks.has(`${currentFloor}-${id}`);

    const item = document.createElement("div");
    item.className = `objective-item ${done ? "completed" : ""}`;

    const check = document.createElement("span");
    check.className = "objective-check";
    check.textContent = done ? "✓" : "";

    const text = document.createElement("span");
    text.textContent = label;

    item.append(check, text);
    $("objective-list").appendChild(item);
  });
}

/* =========================================
   POINTER LOCK AND MOUSE LOOK
========================================= */

function lockMouse() {
  if (!renderer.domElement.requestPointerLock) {
    showToast("Your browser does not support mouse look.");
    return;
  }

  renderer.domElement.requestPointerLock();
}

document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;

  if (pointerLocked) {
    $("menu-screen").classList.add("hidden");
    $("instructions-screen").classList.add("hidden");
    $("pause-screen").classList.add("hidden");
  } else if (gameStarted && !gamePaused && !gameFinished &&
             $("interaction-screen").classList.contains("hidden")) {
    pauseGame();
  }
});

document.addEventListener("mousemove", event => {
  if (!pointerLocked || !gameStarted || gamePaused) return;

  yaw -= event.movementX * 0.0022;
  pitch -= event.movementY * 0.0022;

  pitch = THREE.MathUtils.clamp(pitch, -1.35, 1.35);

  camera.rotation.set(pitch, yaw, 0);
});

/* =========================================
   COLLISION
========================================= */

function blocked(x, z) {
  return colliders.some(c => {
    if (c.floor !== currentFloor) return false;

    return (
      x + PLAYER_RADIUS > c.minX &&
      x - PLAYER_RADIUS < c.maxX &&
      z + PLAYER_RADIUS > c.minZ &&
      z - PLAYER_RADIUS < c.maxZ
    );
  });
}

function movePlayer(delta) {
  if (!pointerLocked || !gameStarted || gamePaused || gameFinished) return;

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

  if (movement.lengthSq() === 0) return;

  movement.normalize().multiplyScalar(speed * delta);

  const nextX = playerPosition.x + movement.x;
  const nextZ = playerPosition.z + movement.z;

  if (!blocked(nextX, playerPosition.z)) {
    playerPosition.x = nextX;
  }

  if (!blocked(playerPosition.x, nextZ)) {
    playerPosition.z = nextZ;
  }

  // Keep player within the school building
  playerPosition.x = THREE.MathUtils.clamp(playerPosition.x, -9.5, 9.5);
  playerPosition.z = THREE.MathUtils.clamp(playerPosition.z, -14.5, 14.5);

  playerPosition.y = (3 - currentFloor) * FLOOR_HEIGHT + PLAYER_HEIGHT;
  camera.position.copy(playerPosition);
}

/* =========================================
   NEAREST INTERACTABLE
========================================= */

function nearestInteractable() {
  let closest = null;
  let shortest = 2.3;

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

function updatePrompt() {
  if (!pointerLocked || !gameStarted || gamePaused) {
    $("interaction-prompt").classList.add("hidden");
    return;
  }

  nearbyObject = nearestInteractable();

  if (nearbyObject) {
    $("interaction-text").textContent = nearbyObject.title;
    $("interaction-prompt").classList.remove("hidden");
    return;
  }

  const nearStairs =
    Math.abs(playerPosition.z - 12.5) < 2.2 &&
    Math.abs(playerPosition.x) < 2.2;

  if (nearStairs) {
    $("interaction-text").textContent =
      currentFloor === 1 ? "FINAL FLOOR" : "USE STAIRS";
    $("interaction-prompt").classList.remove("hidden");
    return;
  }

  $("interaction-prompt").classList.add("hidden");
}

/* =========================================
   INTERACTION
========================================= */

function openInteraction(item) {
  if (!item) return;

  const taskKey = `${item.floor}-${item.id}`;

  if (completedTasks.has(taskKey)) {
    showToast("You already completed this task.");
    return;
  }

  activeInteraction = item;

  $("interaction-category").textContent =
    `FLOOR ${item.floor} • MISSION TASK`;

  $("interaction-title").textContent = item.title;
  $("interaction-description").textContent = item.description;
  $("interaction-extra").textContent = item.detail;

  $("complete-button").textContent =
    item.kind === "submission" ? "SUBMIT THESIS" : "COMPLETE TASK";

  document.exitPointerLock();
  $("interaction-screen").classList.remove("hidden");
}

function completeInteraction() {
  if (!activeInteraction) return;

  const item = activeInteraction;
  const taskKey = `${item.floor}-${item.id}`;

  completedTasks.add(taskKey);
  score += 150;
  activeInteraction = null;

  $("interaction-screen").classList.add("hidden");

  updateHUD();

  if (item.kind === "submission") {
    finishGame(true);
    return;
  }

  const allDone = floorInfo[currentFloor].tasks.every(task =>
    completedTasks.has(`${currentFloor}-${task[1]}`)
  );

  showToast(
    allDone
      ? "ALL TASKS COMPLETED! Find the stairs."
      : "TASK COMPLETED! +150 POINTS"
  );

  lockMouse();
}

/* =========================================
   FLOOR TRANSITIONS
========================================= */

function useStairs() {
  if (currentFloor === 1) {
    showToast("You are already on the first floor.");
    return;
  }

  const allDone = floorInfo[currentFloor].tasks.every(task =>
    completedTasks.has(`${currentFloor}-${task[1]}`)
  );

  if (!allDone) {
    showToast("Complete all tasks on this floor first.");
    return;
  }

  const nextFloor = currentFloor - 1;
  setPlayerFloor(nextFloor, 0, 11);

  showToast(`WELCOME TO THE ${nextFloor}${nextFloor === 2 ? "ND" : "ST"} FLOOR!`);
}

function interact() {
  if (!pointerLocked || !gameStarted || gamePaused) return;

  const item = nearestInteractable();

  if (item) {
    openInteraction(item);
    return;
  }

  const nearStairs =
    Math.abs(playerPosition.z - 12.5) < 2.2 &&
    Math.abs(playerPosition.x) < 2.2;

  if (nearStairs) {
    useStairs();
  }
}

/* =========================================
   GAME FLOW
========================================= */

function startGame() {
  completedTasks.clear();

  score = 0;
  timeLeft = 300;
  currentFloor = 3;

  gameStarted = true;
  gamePaused = false;
  gameFinished = false;
  activeInteraction = null;

  yaw = Math.PI;
  pitch = 0;

  setPlayerFloor(3, 0, 11);
  camera.rotation.set(0, yaw, 0);

  $("menu-screen").classList.add("hidden");
  $("instructions-screen").classList.add("hidden");
  $("pause-screen").classList.add("hidden");
  $("result-screen").classList.add("hidden");
  $("interaction-screen").classList.add("hidden");

  $("game-hud").classList.remove("hidden");

  updateHUD();
  lockMouse();
}

function pauseGame() {
  if (!gameStarted || gameFinished || gamePaused) return;

  gamePaused = true;

  if (document.pointerLockElement) {
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

function finishGame(won) {
  gameFinished = true;
  gameStarted = false;
  gamePaused = false;

  if (document.pointerLockElement) {
    document.exitPointerLock();
  }

  $("game-hud").classList.add("hidden");

  $("result-label").textContent =
    won ? "MISSION ACCOMPLISHED" : "DEADLINE MISSED";

  $("result-title").textContent =
    won ? "THESIS SUBMITTED!" : "TIME IS UP!";

  $("result-message").textContent = won
    ? "You completed your tasks and successfully submitted your thesis. Congratulations!"
    : "You ran out of time before completing your thesis. Try again!";

  $("final-score").textContent = String(score).padStart(4, "0");
  $("result-screen").classList.remove("hidden");
}

function returnToMenu() {
  gameStarted = false;
  gamePaused = false;
  gameFinished = false;

  if (document.pointerLockElement) {
    document.exitPointerLock();
  }

  $("game-hud").classList.add("hidden");
  $("pause-screen").classList.add("hidden");
  $("result-screen").classList.add("hidden");
  $("interaction-screen").classList.add("hidden");
  $("menu-screen").classList.remove("hidden");
}

/* =========================================
   BUTTON EVENTS
========================================= */

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

$("restart-button").addEventListener("click", () => {
  $("pause-screen").classList.add("hidden");
  startGame();
});

$("menu-button").addEventListener("click", returnToMenu);
$("complete-button").addEventListener("click", completeInteraction);

$("close-interaction").addEventListener("click", () => {
  activeInteraction = null;
  $("interaction-screen").classList.add("hidden");
  lockMouse();
});

$("play-again-button").addEventListener("click", startGame);
$("result-menu-button").addEventListener("click", returnToMenu);

/* =========================================
   KEYBOARD
========================================= */

window.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();

  keys[key] = true;

  if (
    ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "]
      .includes(key)
  ) {
    event.preventDefault();
  }

  if (key === "e") {
    interact();
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

/* =========================================
   TIMER
========================================= */

setInterval(() => {
  if (!gameStarted || gamePaused || gameFinished) return;

  timeLeft--;
  updateHUD();

  if (timeLeft <= 0) {
    finishGame(false);
  }
}, 1000);

/* =========================================
   ANIMATION LOOP
========================================= */

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  movePlayer(delta);
  updatePrompt();

  renderer.render(scene, camera);
}

animate();

/* =========================================
   RESIZE
========================================= */

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* =========================================
   INITIALIZE
========================================= */

updateHUD();

$("loading-screen").classList.add("hidden");

console.log("The Last Submission loaded.");
console.log("3D school environment ready.");
console.log("First-person controls ready.");
