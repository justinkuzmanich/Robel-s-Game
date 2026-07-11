/* World Cup Striker — swipe-to-shoot penalty shootout.
 * Plain Three.js, no build step. Tuned for 60fps on mobile GPUs
 * (capped pixel ratio, low-poly meshes, canvas textures, no shadow maps). */
'use strict';

// ---------------------------------------------------------------- utils
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const choice = arr => arr[Math.floor(Math.random() * arr.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const el = id => document.getElementById(id);
const vibrate = pattern => { try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) {} };

// ---------------------------------------------------------------- teams & stages
const TEAMS = [
  { name: 'BRAZIL',      flag: '🇧🇷', color: 0xffdc02, alt: 0x179a3b },
  { name: 'ARGENTINA',   flag: '🇦🇷', color: 0x74acdf, alt: 0xffffff },
  { name: 'FRANCE',      flag: '🇫🇷', color: 0x0055a4, alt: 0xef4135 },
  { name: 'GERMANY',     flag: '🇩🇪', color: 0xffffff, alt: 0xdd0000 },
  { name: 'SPAIN',       flag: '🇪🇸', color: 0xaa151b, alt: 0xf1bf00 },
  { name: 'ENGLAND',     flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', color: 0xffffff, alt: 0xce1124 },
  { name: 'PORTUGAL',    flag: '🇵🇹', color: 0x046a38, alt: 0xda291c },
  { name: 'NETHERLANDS', flag: '🇳🇱', color: 0xff6600, alt: 0xffffff },
  { name: 'JAPAN',       flag: '🇯🇵', color: 0xffffff, alt: 0xbc002d },
  { name: 'USA',         flag: '🇺🇸', color: 0xb22234, alt: 0x3c3b6e },
  { name: 'MOROCCO',     flag: '🇲🇦', color: 0xc1272d, alt: 0x006233 },
  { name: 'CROATIA',     flag: '🇭🇷', color: 0xff2222, alt: 0xffffff },
];

// Keeper gets sharper and the rival striker gets deadlier each stage.
const STAGES = [
  { name: 'QUARTERFINAL',   guess: 0.48, reach: 1.00, oppRate: 0.60 },
  { name: 'SEMIFINAL',      guess: 0.58, reach: 1.08, oppRate: 0.68 },
  { name: 'WORLD CUP FINAL', guess: 0.68, reach: 1.16, oppRate: 0.74 },
];

const KICKS = 5;               // best-of-5 shootout, then sudden death
const BALL_R = 0.22;
const GOAL_W = 3.66;           // half width of the goal mouth
const GOAL_H = 2.44;
const POST_R = 0.07;
const SPOT_Z = 11;             // penalty spot distance from the goal line
const GRAV = 9.8;

// ---------------------------------------------------------------- audio (all synthesized, zero assets)
const AudioFX = {
  ctx: null, crowdGain: null, master: null,
  init() {
    if (this.ctx) { this.ctx.resume && this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    // master bus with a compressor so layered cheers never clip
    this.master = this.ctx.createDynamicsCompressor();
    this.master.threshold.value = -18;
    this.master.ratio.value = 6;
    this.master.connect(this.ctx.destination);
    // ambient crowd bed: looped filtered noise
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + (Math.random() * 2 - 1) * 0.04) * 0.98; d[i] = last * 6; }
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 0.4;
    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0.05;
    src.connect(bp).connect(this.crowdGain).connect(this.master);
    src.start();
  },
  // one synthesized human shout: sawtooth "voice" shaped by vowel formant filters
  shout(when, f0, dur, vol, formants, fall) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    if (fall) { // "ohh" — pitch sags downward
      o.frequency.setValueAtTime(f0 * (1.05 + Math.random() * 0.1), t);
      o.frequency.linearRampToValueAtTime(f0 * 0.72, t + dur);
    } else {    // "yeah!" — pitch leaps up into a sustained yell, then trails off
      o.frequency.setValueAtTime(f0 * 0.7, t);
      o.frequency.linearRampToValueAtTime(f0 * (1.08 + Math.random() * 0.18), t + 0.07 + Math.random() * 0.1);
      o.frequency.linearRampToValueAtTime(f0 * (0.82 + Math.random() * 0.12), t + dur);
    }
    // vibrato makes it read as a voice instead of a buzzer
    const vib = this.ctx.createOscillator(), vibGain = this.ctx.createGain();
    vib.frequency.value = 4.5 + Math.random() * 3.5;
    vibGain.gain.value = f0 * 0.035;
    vib.connect(vibGain).connect(o.frequency);
    const mix = this.ctx.createGain();
    for (const fc of formants) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = fc * (0.92 + Math.random() * 0.16);
      f.Q.value = 2.5;
      o.connect(f).connect(mix);
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.04 + Math.random() * 0.06);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.55, dur * 0.25);
    mix.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.4);
    vib.start(t); vib.stop(t + dur + 0.4);
  },
  swell(peak, up, down) { // crowd reaction envelope
    if (!this.ctx) return;
    const g = this.crowdGain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(peak, t + up);
    g.linearRampToValueAtTime(0.05, t + up + down);
  },
  cheer() {
    if (!this.ctx) return;
    this.swell(0.45, 0.08, 2.6);
    // the roar: ~18 overlapping voices shouting on open "aah" formants,
    // staggered starts so it blooms like a real crowd erupting
    const AAH = [780, 1200, 2600];
    for (let i = 0; i < 18; i++) {
      const male = Math.random() < 0.6;
      const f0 = male ? rand(130, 240) : rand(250, 430);
      this.shout(Math.random() * 0.4, f0, rand(0.8, 1.8), rand(0.022, 0.045), AAH, false);
    }
    // scattered celebration whistles
    for (let i = 0; i < 3; i++) {
      const f = rand(1700, 2400);
      this.tone(f, 0.3, 'sine', 0.04, rand(0.3, 1.1), f * 1.3);
    }
  },
  groan() {
    if (!this.ctx) return;
    this.swell(0.22, 0.25, 1.4);
    // a deflated "ohhh" — fewer, lower voices on rounded formants, pitch sagging
    const OHH = [500, 900, 2300];
    for (let i = 0; i < 9; i++) {
      this.shout(Math.random() * 0.25, rand(110, 260), rand(0.7, 1.3), rand(0.015, 0.03), OHH, true);
    }
  },
  tone(freq, dur, type, vol, when = 0, glide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },
  whistle() { this.tone(2100, 0.14, 'square', 0.08); this.tone(2100, 0.3, 'square', 0.08, 0.2); },
  kick() { this.tone(120, 0.12, 'sine', 0.5, 0, 45); },
  clang() { this.tone(310, 0.5, 'square', 0.12); this.tone(316, 0.5, 'square', 0.12); },
  thud() { this.tone(90, 0.18, 'sine', 0.35, 0, 40); },
};

// ---------------------------------------------------------------- three.js scene
const container = el('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // cap fill-rate cost on high-dpi phones
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x071527);
scene.fog = new THREE.Fog(0x071527, 40, 95);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 200);
const CAM_BASE = new THREE.Vector3(0, 2.3, SPOT_Z + 4.6);
camera.position.copy(CAM_BASE);
const camLook = new THREE.Vector3(0, 1.4, 0);
camera.lookAt(camLook);

scene.add(new THREE.HemisphereLight(0x8fb8ff, 0x1d4a24, 0.9));
const sun = new THREE.DirectionalLight(0xfff4d6, 1.5);
sun.position.set(-8, 22, 14);
scene.add(sun);

function makeCanvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- pitch: striped grass + painted penalty-box lines
(function buildPitch() {
  const tex = makeCanvasTex(1024, 1024, (g, w, h) => {
    // world span 44m x 44m centered on the goal line; z: -6 .. 38
    const px = m => (m / 44) * w;
    for (let i = 0; i < 11; i++) {
      g.fillStyle = i % 2 ? '#2e8f3e' : '#25803a';
      g.fillRect(0, (i / 11) * h, w, h / 11 + 1);
    }
    g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineWidth = 5; g.lineCap = 'round';
    const zToY = z => ((z + 6) / 44) * h, xToX = x => w / 2 + px(x);
    // goal line, penalty box (16.5m deep, 40.3m wide clipped), goal area, spot, arc
    g.beginPath(); g.moveTo(0, zToY(0)); g.lineTo(w, zToY(0)); g.stroke();
    g.strokeRect(xToX(-16.5), zToY(0), px(33), px(16.5));
    g.strokeRect(xToX(-7.3), zToY(0), px(14.6), px(5.5));
    g.beginPath(); g.arc(xToX(0), zToY(SPOT_Z), 7, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    g.beginPath(); g.arc(xToX(0), zToY(SPOT_Z), px(9.15), Math.PI * 0.28, Math.PI * 0.72); g.stroke();
  });
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 44),
    new THREE.MeshLambertMaterial({ map: tex })
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, 0, 16); // spans z in [-6, 38]
  scene.add(pitch);
  // apron beyond the textured pitch so the fog line never shows raw background
  const apron = new THREE.Mesh(
    new THREE.CircleGeometry(90, 24),
    new THREE.MeshLambertMaterial({ color: 0x1d6330 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  scene.add(apron);
})();

// ---- goal frame + net
(function buildGoal() {
  const frameMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
  const postGeo = new THREE.CylinderGeometry(POST_R, POST_R, GOAL_H, 10);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, frameMat);
    post.position.set(s * GOAL_W, GOAL_H / 2, 0);
    scene.add(post);
    // box frame: vertical back post + top rail running straight back
    const backPost = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, GOAL_H, 8), frameMat);
    backPost.position.set(s * GOAL_W, GOAL_H / 2, -1.9);
    scene.add(backPost);
    const topRail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 8), frameMat);
    topRail.rotation.x = Math.PI / 2;
    topRail.position.set(s * GOAL_W, GOAL_H, -0.95);
    scene.add(topRail);
  }
  // back top rail: closes the box frame and makes the roof's rear edge read clearly
  const backRail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, GOAL_W * 2, 10), frameMat);
  backRail.rotation.z = Math.PI / 2;
  backRail.position.set(0, GOAL_H, -1.9);
  scene.add(backRail);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(POST_R, POST_R, GOAL_W * 2 + POST_R * 2, 10), frameMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, GOAL_H, 0);
  scene.add(bar);

  const netTex = makeCanvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 2.5;
    for (let i = 0; i <= 16; i++) {
      g.beginPath(); g.moveTo((i / 16) * w, 0); g.lineTo((i / 16) * w, h); g.stroke();
      g.beginPath(); g.moveTo(0, (i / 16) * h); g.lineTo(w, (i / 16) * h); g.stroke();
    }
  });
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
  const netMat = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const netPanel = (w, h, rx, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), netMat.clone());
    m.material.map = netTex.clone();
    m.material.map.repeat.set(w / 0.9, h / 0.9);
    m.material.map.anisotropy = maxAniso; // keep the mesh visible at grazing angles (the roof especially)
    m.rotation.x = rx || 0; m.rotation.y = ry || 0;
    scene.add(m);
    return m;
  };
  // box net, all 90° angles: a flat roof at crossbar height running straight
  // back, a vertical back wall, and rectangular sides — every edge meets flush
  const NET_D = 1.9; // net depth behind the goal line
  const panels = [
    netPanel(GOAL_W * 2, GOAL_H),                    // back wall
    netPanel(GOAL_W * 2, NET_D, -Math.PI / 2),       // flat roof at bar height
    netPanel(NET_D, GOAL_H, 0, Math.PI / 2),         // sides
    netPanel(NET_D, GOAL_H, 0, Math.PI / 2),
  ];
  panels[0].position.set(0, GOAL_H / 2, -NET_D);
  panels[1].position.set(0, GOAL_H, -NET_D / 2);
  panels[2].position.set(-GOAL_W, GOAL_H / 2, -NET_D / 2);
  panels[3].position.set(GOAL_W, GOAL_H / 2, -NET_D / 2);
  window.setNetOpacity = o => panels.forEach(p => { p.material.opacity = o; });
})();

// ---- stadium bowl: crowd texture on the inside of a cylinder
(function buildStadium() {
  const crowdTex = makeCanvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#0c1524'; g.fillRect(0, 0, w, h);
    const cols = ['#e8e4da', '#f2c94c', '#eb5757', '#2f80ed', '#27ae60', '#f7f7f7', '#9b51e0', '#ff7a29'];
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      g.globalAlpha = rand(0.25, 0.75);
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.globalAlpha = 1;
  });
  crowdTex.wrapS = THREE.RepeatWrapping;
  crowdTex.repeat.set(6, 1);
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(48, 40, 20, 36, 1, true),
    new THREE.MeshBasicMaterial({ map: crowdTex, side: THREE.BackSide, fog: false })
  );
  bowl.position.set(0, 10, 12);
  scene.add(bowl);
  // roof rim
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(50, 48, 3, 36, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x0b1420, side: THREE.DoubleSide, fog: false })
  );
  rim.position.set(0, 21.5, 12);
  scene.add(rim);
  // floodlight glows
  const glowTex = makeCanvasTex(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,250,220,1)');
    r.addColorStop(0.25, 'rgba(255,245,200,.55)');
    r.addColorStop(1, 'rgba(255,245,200,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
  for (const [x, z] of [[-30, -14], [30, -14], [-34, 34], [34, 34]]) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, fog: false, depthWrite: false }));
    s.position.set(x, 24, z);
    s.scale.set(10, 10, 1);
    scene.add(s);
  }
})();

// ---- ad boards behind the goal
const adBoard = (function () {
  const tex = makeCanvasTex(1024, 64, (g, w, h) => {
    g.fillStyle = '#0a1f3d'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c9a53f';
    g.font = '900 34px sans-serif'; g.textBaseline = 'middle';
    for (let x = 30; x < w; x += 300) g.fillText('WORLD CUP 2026 ⬥', x, h / 2);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(26, 0.75), new THREE.MeshBasicMaterial({ map: tex }));
  m.position.set(0, 0.38, -5.2);
  scene.add(m);
  return m;
})();

// ---- ball with classic panel texture + player-colored trail
const ball = (function () {
  const tex = makeCanvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#191919';
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const cx = (x + 0.5 + (y % 2) * 0.5) * (w / 4), cy = (y + 0.5) * (h / 4);
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * 17, cy + Math.sin(a) * 17);
      }
      g.fill();
    }
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 20, 16),
    new THREE.MeshPhongMaterial({ map: tex, shininess: 40 })
  );
  scene.add(mesh);
  return mesh;
})();

const TRAIL_N = 24;
const trail = (function () {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0xffd75e, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  line.frustumCulled = false;
  scene.add(line);
  return line;
})();

// cheap blob shadows (no shadow maps)
const shadowTex = makeCanvasTex(128, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(0,0,0,.5)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, h);
});
function blobShadow(size) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.015;
  scene.add(m);
  return m;
}
const ballShadow = blobShadow(0.9);
const keeperShadow = blobShadow(2.2);

// ---- shared humanoid rig: rounded capsule limbs, natural elbow bends, kit details.
// facing: +1 the player looks toward +z (keeper), -1 toward -z (striker).
// Returns the same pivot structure the animations drive: {group, arms, kickHip, jerseyMat}.
function buildPlayerRig({ jersey = 0xff8c1a, shorts = 0x15181e, skin = 0xd9a06b, hair = 0x241708,
  gloves = null, facing = 1, kickLeg = false } = {}) {
  const group = new THREE.Group();
  const jerseyMat = new THREE.MeshLambertMaterial({ color: jersey });
  const shortsMat = new THREE.MeshLambertMaterial({ color: shorts });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const hairMat = new THREE.MeshLambertMaterial({ color: hair });
  const sockMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x191919 });
  const handMat = gloves ? new THREE.MeshLambertMaterial({ color: gloves }) : skinMat;

  const add = (geo, mat, x, y, z, parent) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    (parent || group).add(m);
    return m;
  };
  const leg = (s, parent, ox = 0, oy = 0) => { // thigh, sock, boot — one leg
    add(new THREE.CapsuleGeometry(0.078, 0.3, 4, 10), skinMat, s * 0.115 + ox, 0.63 + oy, 0, parent);
    add(new THREE.CapsuleGeometry(0.068, 0.26, 4, 10), sockMat, s * 0.115 + ox, 0.26 + oy, 0, parent);
    add(new THREE.BoxGeometry(0.15, 0.09, 0.27), darkMat, s * 0.115 + ox, 0.05 + oy, facing * 0.05, parent);
  };

  let kickHip = null;
  if (kickLeg) {
    leg(-1);
    kickHip = new THREE.Group(); // strike leg swings from the hip
    kickHip.position.set(0.115, 0.82, 0);
    leg(0, kickHip, 0, -0.82);
    group.add(kickHip);
  } else {
    leg(-1); leg(1);
  }

  add(new THREE.CylinderGeometry(0.21, 0.23, 0.26, 12), shortsMat, 0, 0.9, 0);
  const torso = add(new THREE.CapsuleGeometry(0.19, 0.34, 6, 14), jerseyMat, 0, 1.24, 0);
  torso.scale.set(1.3, 1, 0.78); // shoulders
  add(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 8), skinMat, 0, 1.55, 0);   // neck
  add(new THREE.SphereGeometry(0.135, 16, 12), skinMat, 0, 1.7, 0);            // head
  const hairCap = add(new THREE.SphereGeometry(0.142, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
    hairMat, 0, 1.705, -facing * 0.02);
  hairCap.rotation.x = -facing * 0.25;
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.016, 6, 6), darkMat, s * 0.05, 1.72, facing * 0.115); // eyes

  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.27, 1.42, 0);
    const upper = add(new THREE.CapsuleGeometry(0.062, 0.2, 4, 10), jerseyMat, 0, -0.13, 0, pivot);
    const fore = add(new THREE.CapsuleGeometry(0.054, 0.17, 4, 10), skinMat, 0, -0.31, facing * 0.05, pivot);
    fore.rotation.x = facing * 0.4; // relaxed elbow bend
    add(new THREE.SphereGeometry(0.075, 10, 8), handMat, 0, -0.42, facing * 0.11, pivot);
    pivot.rotation.z = s * 0.5; // ready stance, arms out
    group.add(pivot);
    arms.push(pivot);
  }
  return { group, arms, kickHip, jerseyMat };
}

// ---- goalkeeper
const keeper = (function () {
  const rig = buildPlayerRig({ jersey: 0xff8c1a, gloves: 0xf2f2f2, facing: 1, skin: 0xa96f45 });
  const group = rig.group, arms = rig.arms, jersey = rig.jerseyMat;
  group.scale.setScalar(1.06); // keepers are big
  group.position.set(0, 0, 0.25);
  scene.add(group);

  return {
    group, arms,
    jerseyMat: jersey,
    dive: null,             // {type:'dive'|'stand'|'jump', side, targetY, start, dur, bx}
    baseX: 0,               // kept at 0 in lean control; dives launch from center
    lean: 0,                // player-controlled body lean, world units (-1 .. 1)
    playerControlled: false, // true while YOU are the keeper: lean with the finger instead of idle sway
    idleT: 0,
    reset() {
      this.dive = null;
      this.baseX = 0;
      this.lean = 0;
      group.position.set(0, 0, 0.25);
      group.rotation.set(0, 0, 0);
      arms[0].rotation.z = -0.5;
      arms[1].rotation.z = 0.5;
    },
    startDive(dirX, targetY, dur, startAt) {
      this.dive = {
        type: dirX === 0 ? 'stand' : 'dive',
        dirX, targetY, dur,
        start: startAt != null ? startAt : performance.now() / 1000, // startAt: replay a remote dive on its original timeline
        side: Math.sign(dirX) || (Math.random() < 0.5 ? 1 : -1),
        bx: this.baseX, // dive launches from wherever the keeper shuffled to
      };
    },
    startJump(dur, startAt) {
      this.dive = { type: 'jump', dirX: 0, targetY: 2.4, dur, start: startAt != null ? startAt : performance.now() / 1000, side: 0, bx: this.baseX };
    },
    progress(now) {
      if (!this.dive) return 0;
      return clamp((now - this.dive.start) / this.dive.dur, 0, 1);
    },
    // analytic coverage used by the save check: a thick segment from hip to gloves
    coverage(p) {
      const bx = this.dive ? this.dive.bx : this.baseX;
      if (!this.dive || this.dive.type === 'stand') {
        return { ax: bx, ay: 0.3, bx: bx, by: 2.0, r: 0.5 };
      }
      const d = this.dive;
      if (d.type === 'jump') { // vertical leap: strong up high, beatable along the ground
        return { ax: bx, ay: lerp(0.5, 1.1, p), bx: bx, by: lerp(2.0, 2.6, p), r: 0.5 };
      }
      const handX = bx + d.side * (0.35 + 1.75 * p); // corners stay beatable even on a correct guess
      const handY = clamp(lerp(1.7, d.targetY, p), 0.25, 2.35);
      const hipX = bx + d.side * (0.15 + 0.95 * p);
      const hipY = lerp(0.95, Math.max(0.45, d.targetY * 0.45), p);
      return { ax: hipX, ay: hipY, bx: handX, by: handY, r: 0.45 };
    },
    // 0→1 over half a second, starting a beat after the action lands: the get-up
    recovery(now) {
      const t = now - this.dive.start - this.dive.dur - 0.45;
      const r = clamp(t / 0.5, 0, 1);
      return r * r * (3 - 2 * r); // smoothstep
    },
    update(now, dt) {
      if (this.dive && this.dive.type === 'jump') { // vertical leap, arms high
        const p = this.progress(now);
        const e = 1 - Math.pow(1 - p, 2.2);
        const re = this.recovery(now); // arms come back down after landing
        group.position.x = this.dive.bx;
        group.position.y = Math.sin(Math.min(p, 1) * Math.PI) * 0.95;
        arms[0].rotation.z = lerp(lerp(-0.5, -2.8, e), -0.5, re);
        arms[1].rotation.z = lerp(lerp(0.5, 2.8, e), 0.5, re);
      } else if (this.dive && this.dive.type === 'stand') { // standing his ground: arms up, small hop
        const p = this.progress(now);
        const e = 1 - Math.pow(1 - p, 2.2);
        const re = this.recovery(now);
        group.position.x = lerp(group.position.x, this.dive.bx, 0.3);
        group.position.y = Math.sin(Math.min(p, 1) * Math.PI) * 0.22;
        arms[0].rotation.z = lerp(lerp(-0.5, -2.7, e), -0.5, re);
        arms[1].rotation.z = lerp(lerp(0.5, 2.7, e), 0.5, re);
      } else if (this.dive) {
        const p = this.progress(now);
        const e = 1 - Math.pow(1 - p, 2.2); // ease-out
        const d = this.dive;
        // after the dive lands, push up onto one knee instead of lying on the turf
        const re = this.recovery(now);
        const rotFull = clamp(1.55 - d.targetY * 0.3, 0.9, 1.5);
        group.position.x = d.bx + d.side * 1.55 * e;
        group.position.y = Math.sin(Math.min(p, 1) * Math.PI) * clamp(d.targetY - 0.6, 0.05, 0.85) - re * 0.26;
        group.rotation.z = -d.side * lerp(rotFull * e, 0.18, re);
        group.rotation.x = re * 0.42; // kneeling lean, weight on the front knee
        arms[d.side > 0 ? 1 : 0].rotation.z = lerp(d.side * lerp(0.5, 2.6, e), d.side * 0.5, re);
        arms[d.side > 0 ? 0 : 1].rotation.z = lerp(-d.side * lerp(0.5, 1.4, e), -d.side * 0.5, re);
      } else if (this.playerControlled) {
        // you are the keeper: the body leans with your finger, coiled to spring
        const k = Math.min(1, dt * 14);
        group.position.x = lerp(group.position.x, this.lean * 0.55, k);
        group.rotation.z = lerp(group.rotation.z, -this.lean * 0.38, k);
        group.position.y = Math.abs(this.lean) * 0.04;
      } else {
        // AI idle: sway side to side, tiny bounce
        this.idleT += dt;
        group.position.x = Math.sin(this.idleT * 1.7) * 0.22;
        group.position.y = Math.abs(Math.sin(this.idleT * 3.4)) * 0.045;
      }
      keeperShadow.position.x = group.position.x;
      keeperShadow.position.z = group.position.z;
    },
  };
})();

// ---- opposing striker (visible in keeper mode): runs up and strikes the ball
const striker = (function () {
  const rig = buildPlayerRig({ jersey: 0x3f6cff, facing: -1, kickLeg: true, skin: 0xdba372, hair: 0x11100e });
  const group = rig.group, jersey = rig.jerseyMat, kickHip = rig.kickHip;
  rig.arms[0].rotation.z = -0.35; // relaxed at his sides for the run-up
  rig.arms[1].rotation.z = 0.35;
  group.visible = false;
  scene.add(group);

  const START = new THREE.Vector3(0.4, 0, 13.0);
  const STRIKE = new THREE.Vector3(0.28, 0, 11.55);
  let anim = null;
  let idleT = 0;
  return {
    group,
    jerseyMat: jersey,
    show(v) { group.visible = v; },
    reset() {
      anim = null;
      group.position.copy(START);
      kickHip.rotation.x = 0;
    },
    startRun(dur, now) { anim = { t0: now, dur }; }, // boot meets ball ~0.1s after dur
    update(now, dt) {
      if (!group.visible) return;
      if (!anim) {
        idleT += dt;
        group.position.y = Math.abs(Math.sin(idleT * 2.2)) * 0.03;
        return;
      }
      const t = (now - anim.t0) / anim.dur;
      if (t < 1) {
        group.position.lerpVectors(START, STRIKE, t);
        group.position.y = Math.abs(Math.sin(t * Math.PI * 3)) * 0.07;
        kickHip.rotation.x = lerp(0, 0.9, t); // backswing
      } else {
        const k = clamp((now - anim.t0 - anim.dur) / 0.12, 0, 1);
        group.position.copy(STRIKE);
        kickHip.rotation.x = lerp(0.9, -1.15, k); // strike through the ball
      }
    },
  };
})();

// ---- aim reticle shown while dragging
const reticle = (function () {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.045, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.9, depthWrite: false })
  );
  m.visible = false;
  scene.add(m);
  return m;
})();

// ---- confetti burst (single Points pool, recycled)
const confetti = (function () {
  const N = 260;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.14, vertexColors: true, transparent: true, opacity: 0, depthWrite: false,
  }));
  pts.frustumCulled = false;
  scene.add(pts);
  const vel = new Float32Array(N * 3);
  let life = 0;
  return {
    burst(cx, cy, cz, colors) {
      const c1 = new THREE.Color(colors[0]), c2 = new THREE.Color(colors[1]);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = cx + rand(-0.4, 0.4);
        pos[i * 3 + 1] = cy + rand(-0.2, 0.2);
        pos[i * 3 + 2] = cz + rand(-0.3, 0.3);
        vel[i * 3] = rand(-3.2, 3.2);
        vel[i * 3 + 1] = rand(2.5, 7.5);
        vel[i * 3 + 2] = rand(-2.5, 2.5);
        const c = Math.random() < 0.5 ? c1 : c2;
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      life = 2.2;
      pts.material.opacity = 1;
    },
    update(dt) {
      if (life <= 0) return;
      life -= dt;
      for (let i = 0; i < N; i++) {
        vel[i * 3 + 1] -= 7 * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < 0.02) { pos[i * 3 + 1] = 0.02; vel[i * 3 + 1] = 0; vel[i * 3] *= 0.9; }
      }
      geo.attributes.position.needsUpdate = true;
      pts.material.opacity = clamp(life, 0, 1);
    },
  };
})();

// ---------------------------------------------------------------- ball physics
const Ball = {
  pos: new THREE.Vector3(0, BALL_R, SPOT_Z),
  vel: new THREE.Vector3(),
  curve: 0,          // lateral (Magnus) acceleration, m/s^2
  flying: false,
  crossed: false,
  netted: false,
  spinAxis: new THREE.Vector3(1, 0, 0),
  spinRate: 0,
  onCross: null,     // callback fired once when the ball reaches the goal plane

  placeOnSpot() {
    this.flying = false; this.crossed = false; this.netted = false;
    this.pos.set(0, BALL_R, SPOT_Z);
    this.vel.set(0, 0, 0);
    this.spinRate = 0;
    trail.visible = false;
    this.syncMesh();
  },
  kick(target, power, curveIn) {
    const t = lerp(1.05, 0.5, power); // flight time to the goal plane
    this.curve = curveIn * 13;
    this.vel.set(
      (target.x - this.pos.x) / t - 0.5 * this.curve * t,
      (target.y - this.pos.y) / t + 0.5 * GRAV * t,
      -SPOT_Z / t
    );
    this.flying = true; this.crossed = false; this.netted = false;
    this.flightTime = t;
    this.spinAxis.set(1, 0, curveIn * -1.6).normalize();
    this.spinRate = this.vel.length() / BALL_R;
    this.trailIdx = 0;
    const tp = trail.geometry.attributes.position.array;
    for (let i = 0; i < TRAIL_N; i++) {
      tp[i * 3] = this.pos.x; tp[i * 3 + 1] = this.pos.y; tp[i * 3 + 2] = this.pos.z;
    }
    trail.visible = true;
  },
  update(dt, now) {
    if (!this.flying) return;
    const prevZ = this.pos.z;
    this.vel.y -= GRAV * dt;
    if (!this.crossed) this.vel.x += this.curve * dt;
    if (this.netted) {
      const damp = Math.pow(0.0015, dt); // the net eats momentum fast
      this.vel.x *= damp; this.vel.z *= damp;
    }
    this.pos.addScaledVector(this.vel, dt);

    // ground bounce / roll
    if (this.pos.y < BALL_R) {
      this.pos.y = BALL_R;
      if (Math.abs(this.vel.y) > 0.8) AudioFX.thud();
      this.vel.y = Math.abs(this.vel.y) * 0.45;
      this.vel.x *= 0.85; this.vel.z *= 0.85;
    }
    // net back panel
    if (this.netted && this.pos.z < -1.7) { this.pos.z = -1.7; this.vel.z = Math.abs(this.vel.z) * 0.2; }

    // goal-plane crossing: evaluate the shot exactly once
    if (!this.crossed && prevZ > 0 && this.pos.z <= 0) {
      this.crossed = true;
      const f = prevZ / (prevZ - this.pos.z); // fraction of this step at which the plane was hit
      const cx = lerp(this.pos.x - this.vel.x * dt, this.pos.x, f);
      const cy = lerp(this.pos.y - this.vel.y * dt, this.pos.y, f);
      if (this.onCross) this.onCross(cx, cy, now);
    }

    // spin + trail
    ball.rotateOnWorldAxis(this.spinAxis, this.spinRate * dt);
    this.spinRate *= Math.pow(0.5, dt);
    const tp = trail.geometry.attributes.position.array;
    for (let i = TRAIL_N - 1; i > 0; i--) {
      tp[i * 3] = tp[(i - 1) * 3]; tp[i * 3 + 1] = tp[(i - 1) * 3 + 1]; tp[i * 3 + 2] = tp[(i - 1) * 3 + 2];
    }
    tp[0] = this.pos.x; tp[1] = this.pos.y; tp[2] = this.pos.z;
    trail.geometry.attributes.position.needsUpdate = true;
    this.syncMesh();
  },
  syncMesh() {
    ball.position.copy(this.pos);
    ballShadow.position.x = this.pos.x;
    ballShadow.position.z = this.pos.z;
    const s = clamp(1 - this.pos.y * 0.12, 0.35, 1);
    ballShadow.scale.set(s, s, 1);
    ballShadow.material.opacity = s;
  },
};

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-6;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  const qx = ax + dx * t, qy = ay + dy * t;
  return Math.hypot(px - qx, py - qy);
}

// ---------------------------------------------------------------- online transport
// PeerJS (WebRTC data channel, free cloud signaling) in production;
// a BroadcastChannel loopback (?loop=NAME + ?host=1) for automated two-tab testing.
const Net = {
  peer: null, conn: null, bc: null,
  connected: false,
  isHost: false,
  handlers: {},
  onOpen: null, onLost: null,
  lastHeard: 0,
  _pingTimer: null,

  makeCode() {
    const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
    let s = '';
    for (let i = 0; i < 5; i++) s += A[(Math.random() * A.length) | 0];
    return s;
  },
  loopParam: () => new URLSearchParams(location.search).get('loop'),

  create(code, onStatus) {
    this.isHost = true;
    if (this.loopParam()) return this._loop(true);
    this.peer = new Peer('rwcs-' + code, { debug: 0 });
    this.peer.on('open', () => onStatus('Waiting for your opponent...'));
    this.peer.on('connection', c => { this.conn = c; this._wire(c); });
    this.peer.on('error', e => onStatus('Connection error (' + e.type + ')'));
  },
  join(code, onStatus) {
    this.isHost = false;
    if (this.loopParam()) return this._loop(false);
    onStatus('Connecting...');
    this.peer = new Peer({ debug: 0 });
    this.peer.on('open', () => {
      const c = this.peer.connect('rwcs-' + code, { reliable: true });
      this.conn = c;
      this._wire(c);
    });
    this.peer.on('error', e => onStatus(e.type === 'peer-unavailable'
      ? 'No match found with that code.' : 'Connection error (' + e.type + ')'));
  },
  _wire(c) {
    c.on('open', () => { this.connected = true; this._heartbeat(); if (this.onOpen) this.onOpen(); });
    c.on('data', d => this._recv(d));
    c.on('close', () => this._lost());
    c.on('error', () => this._lost());
  },
  _loop(host) {
    this.bc = new BroadcastChannel('rwcs-' + this.loopParam());
    this.bc.onmessage = ev => {
      const d = ev.data;
      if (d === '__hello__') { if (host) { this.bc.postMessage('__hi__'); this._open(); } }
      else if (d === '__hi__') { if (!host) this._open(); }
      else if (d && typeof d === 'object') this._recv(d);
    };
    if (!host) { // retry until the host tab answers
      const iv = setInterval(() => {
        if (this.connected || !this.bc) clearInterval(iv);
        else this.bc.postMessage('__hello__');
      }, 300);
      this.bc.postMessage('__hello__');
    }
  },
  _open() {
    if (this.connected) return;
    this.connected = true;
    this._heartbeat();
    if (this.onOpen) this.onOpen();
  },
  send(msg) {
    try {
      if (this.bc) this.bc.postMessage(msg);
      else if (this.conn && this.connected) this.conn.send(msg);
    } catch (e) {}
  },
  _recv(msg) {
    this.lastHeard = performance.now();
    if (msg.t === 'ping') { this.send({ t: 'pong' }); return; }
    if (msg.t === 'pong') return;
    const h = this.handlers[msg.t];
    if (h) h(msg);
  },
  on(t, fn) { this.handlers[t] = fn; },
  _heartbeat() {
    this.lastHeard = performance.now();
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      this.send({ t: 'ping' });
      if (performance.now() - this.lastHeard > 9000) this._lost();
    }, 2500);
  },
  _lost() {
    const cb = this.onLost, was = this.connected;
    this.close();
    if (was && cb) cb();
  },
  close() {
    clearInterval(this._pingTimer);
    this.connected = false;
    try { this.conn && this.conn.close(); } catch (e) {}
    try { this.peer && this.peer.destroy(); } catch (e) {}
    try { this.bc && this.bc.close(); } catch (e) {}
    this.peer = this.conn = this.bc = null;
    this.handlers = {};
    this.onOpen = this.onLost = null;
  },
};

// ---------------------------------------------------------------- game state
const G = {
  state: 'title',      // title | vs | await | flight | defend-ready | defend | between | end | lobby
  mode: 'striker',     // striker | keeper
  playerTeam: null,
  oppTeam: null,
  opponents: [],
  stageIdx: 0,
  pKicks: [], oKicks: [], // arrays of booleans per taken kick
  matchToken: 0,
  firstShotTaken: false,
  firstDiveTaken: false,
  online: null,        // online duel state: {hostFirst, kickT, remoteOutcome, kickParams, ...}
};

let camShake = 0;
let camPush = 0;
let camBack = 0; // keeper cam: smoothed pull-back during the dive/shot

// ---------------------------------------------------------------- UI helpers
const bannerEl = el('banner'), subEl = el('subbanner');
function showBanner(text, cls, subText) {
  bannerEl.textContent = text;
  bannerEl.className = cls;
  void bannerEl.offsetWidth; // restart the pop animation
  bannerEl.classList.add('show');
  subEl.textContent = subText || '';
  subEl.classList.toggle('show', !!subText);
}
function hideBanner() {
  bannerEl.className = '';
  subEl.classList.remove('show');
}

function renderScoreboard() {
  el('sb-pflag').textContent = G.playerTeam.flag;
  el('sb-oflag').textContent = G.oppTeam.flag;
  el('sb-pscore').textContent = G.pKicks.filter(Boolean).length;
  el('sb-oscore').textContent = G.oKicks.filter(Boolean).length;
  const dots = (arr) => {
    const n = Math.max(KICKS, arr.length);
    let html = '';
    for (let i = 0; i < n; i++) {
      const cls = i < arr.length ? (arr[i] ? 'dot goal' : 'dot miss') : 'dot';
      html += `<span class="${cls}"></span>`;
    }
    return html;
  };
  el('sb-pdots').innerHTML = dots(G.pKicks);
  el('sb-odots').innerHTML = dots(G.oKicks);
}

// shootout decided? (standard best-of-5 early termination + sudden death)
function shootoutResult() {
  const p = G.pKicks.filter(Boolean).length, o = G.oKicks.filter(Boolean).length;
  const pTaken = G.pKicks.length, oTaken = G.oKicks.length;
  if (pTaken <= KICKS && oTaken <= KICKS) {
    const pLeft = KICKS - pTaken, oLeft = KICKS - oTaken;
    if (p > o + oLeft) return 'win';
    if (o > p + pLeft) return 'lose';
    if (pTaken === KICKS && oTaken === KICKS && p !== o) return p > o ? 'win' : 'lose';
    return null;
  }
  // sudden death: judge only once both sides have taken the same number of kicks
  if (pTaken === oTaken && p !== o) return p > o ? 'win' : 'lose';
  return null;
}

// ---------------------------------------------------------------- input: swipe to shoot
const swipe = { active: false, id: null, points: [] };

// forgiving flick mapping: swipe height picks shot height, sideways drift picks the corner.
// A raw camera raycast made most natural flicks sail over the bar on portrait screens.
function aimTarget(first, cur) {
  const upNorm = clamp((first.y - cur.y) / (window.innerHeight * 0.45), 0, 1.4);
  const sideNorm = clamp((cur.x - first.x) / (window.innerWidth * 0.34), -1.6, 1.6);
  return new THREE.Vector3(
    sideNorm * GOAL_W,
    0.15 + Math.pow(upNorm, 1.2) * 2.2, // full-frame height needs a ~45%-of-screen flick; beyond that risks the bar
    0
  );
}

function aimFromSwipe() {
  const pts = swipe.points;
  const first = pts[0], last = pts[pts.length - 1];
  const target = aimTarget(first, last);

  const dt = Math.max(30, last.t - first.t);
  const dist = Math.hypot(last.x - first.x, last.y - first.y);
  const speed = dist / dt; // px per ms
  const power = clamp(speed / (window.innerHeight * 0.0038), 0.15, 1);

  // curve: signed lateral deviation of the mid-path from the straight chord
  let curve = 0;
  if (pts.length > 4) {
    const mid = pts[(pts.length / 2) | 0];
    const chordX = lerp(first.x, last.x, 0.5), chordY = lerp(first.y, last.y, 0.5);
    const nx = -(last.y - first.y), ny = last.x - first.x;
    const nl = Math.hypot(nx, ny) || 1;
    curve = clamp((((mid.x - chordX) * nx + (mid.y - chordY) * ny) / nl) / (window.innerWidth * 0.14), -1, 1);
  }
  // overpowered shots get wild
  if (power > 0.86) {
    target.y += (power - 0.86) * rand(4, 9);
    target.x += (power - 0.86) * rand(-6, 6);
  }
  return { target, power, curve };
}

const canDive = () => (G.state === 'defend' || G.state === 'defend-ready') && !keeper.dive;

// lean control: finger offset from where you pressed, normalized.
// The keeper cam faces the pitch, so a finger moved screen-right leans the keeper
// toward the player's right, which is world -x.
const leanOf = (first, cur) => clamp(-(cur.x - first.x) / (window.innerWidth * 0.35), -1, 1);
const liftOf = (first, cur) => clamp((first.y - cur.y) / (window.innerHeight * 0.22), 0, 1.2);

function onPointerDown(e) {
  if (swipe.active) return;
  if (G.state !== 'await' && !canDive()) return;
  swipe.active = true;
  swipe.id = e.pointerId;
  swipe.points = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
}
function onPointerMove(e) {
  if (!swipe.active || e.pointerId !== swipe.id) return;
  swipe.points.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  if (swipe.points.length > 64) swipe.points.shift();
  if (canDive()) { // holding: the keeper leans with your finger
    keeper.lean = leanOf(swipe.points[0], { x: e.clientX, y: e.clientY });
    return;
  }
  if (G.state !== 'await') return;
  // live aim reticle uses the same mapping as the shot itself
  const t = aimTarget(swipe.points[0], { x: e.clientX, y: e.clientY });
  reticle.visible = true;
  reticle.position.set(t.x, t.y, 0.05);
}
function onPointerUp(e) {
  if (!swipe.active || e.pointerId !== swipe.id) return;
  swipe.active = false;
  const pts = swipe.points;
  if (G.state === 'await') {
    reticle.visible = false;
    if (pts.length < 3) return;
    const first = pts[0], last = pts[pts.length - 1];
    if (first.y - last.y < window.innerHeight * 0.04) return; // must swipe upward
    takeShot(aimFromSwipe());
  } else if (canDive() && pts.length >= 1) {
    G.firstDiveTaken = true;
    el('hint').classList.add('hidden');
    const first = pts[0], last = pts[pts.length - 1];
    const lean = leanOf(first, last);   // which way you're committed
    const lift = liftOf(first, last);   // how high you pushed the dive
    keeper.lean = 0;
    vibrate(20);
    if (Math.abs(lean) >= 0.15) {
      // spring off the lean: dive that way, higher finger = higher dive
      keeper.startDive(Math.sign(lean), clamp(0.5 + lift * 1.9, 0.4, 2.35), 0.34);
    } else if (lift > 0.3) {
      keeper.startJump(0.34); // straight up for the high ball
    } else {
      keeper.startDive(0, 1.0, 0.3); // stand tall in the middle
    }
    if (G.online) sendDiveToOpponent(); // their phone replays my dive on its own timeline
  }
}
window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);

// ---------------------------------------------------------------- shot resolution
let resolveShot = null; // promise resolver for the in-flight shot
let shotSeq = 0;

function takeShot({ target, power, curve }) {
  G.state = 'flight';
  const myShot = ++shotSeq;
  setTimeout(() => { if (shotSeq === myShot) finishShot('wide'); }, 4000); // never leave the match loop hanging
  G.firstShotTaken = true;
  el('hint').classList.add('hidden');
  AudioFX.kick();
  vibrate(25);
  camPush = 1;

  Ball.kick(target, power, curve);

  if (G.online) {
    // online: send the kick to the opponent's phone. Their keeper is the referee;
    // our local crossing verdict only drives the ball visuals until theirs arrives.
    G.online.kickT = performance.now() / 1000;
    G.online.remoteOutcome = null;
    G.online.crossed = false;
    Net.send({ t: 'kick', x: target.x, y: target.y, power, curve });
    Ball.onCross = (cx, cy, now) => {
      resolveCrossing(cx, cy, now, PLAYER_REACH, PLAYER_RADIUS); // visuals: net vs parry vs clang
      G.online.crossed = true;
      if (G.online.remoteOutcome) finishShot(G.online.remoteOutcome);
    };
    return;
  }

  const stage = STAGES[G.stageIdx];
  // keeper decides: read the shot (scaled by stage skill, easier on slow shots)
  const slowBonus = Ball.flightTime > 0.88 ? 0.22 : 0;
  const inGoal = Math.abs(target.x) < GOAL_W && target.y < GOAL_H;
  const shotSide = Math.sign(target.x) || (Math.random() < 0.5 ? 1 : -1);
  let dirX;
  if (Math.random() < 0.12) dirX = 0; // keeper stays home
  else if (inGoal && Math.random() < stage.guess + slowBonus) dirX = shotSide; // read it
  else dirX = Math.random() < 0.75 ? -shotSide : shotSide; // wrong read, usually the opposite corner
  const diveY = clamp((inGoal ? target.y : rand(0.4, 1.8)) + rand(-0.45, 0.45), 0.3, 2.3);
  // fixed-ish dive time: hard shots arrive before the keeper is fully stretched
  const diveDur = Math.max(0.62, Ball.flightTime - 0.08);
  setTimeout(() => keeper.startDive(dirX, diveY, diveDur), 100);

  Ball.onCross = (cx, cy, now) => finishShot(resolveCrossing(cx, cy, now, stage.reach));
}

// evaluate a shot the moment it reaches the goal plane; applies deflections and impact sounds.
// `reach` scales the keeper's coverage (stage skill for the AI keeper, a fixed bonus for you).
function resolveCrossing(cx, cy, now, reach, radiusBonus = 0) {
  const nearPostL = Math.abs(cx + GOAL_W) < BALL_R + POST_R && cy < GOAL_H + 0.2;
  const nearPostR = Math.abs(cx - GOAL_W) < BALL_R + POST_R && cy < GOAL_H + 0.2;
  const nearBar = Math.abs(cy - GOAL_H) < BALL_R + POST_R && Math.abs(cx) < GOAL_W + 0.2;
  if (nearPostL || nearPostR || nearBar) {
    AudioFX.clang();
    vibrate([20, 30, 20]);
    camShake = 0.5;
    Ball.vel.z = Math.abs(Ball.vel.z) * 0.45;
    if (nearBar) Ball.vel.y = -Math.abs(Ball.vel.y) * 0.3 - 2;
    else Ball.vel.x = (cx > 0 ? -1 : 1) * Math.abs(Ball.vel.x) * 0.6 + (cx > 0 ? -2 : 2);
    return 'post';
  }
  if (Math.abs(cx) >= GOAL_W || cy >= GOAL_H) return cy >= GOAL_H ? 'over' : 'wide';

  // save check: distance from ball to the keeper's dive-coverage segment
  const p = keeper.progress(now);
  const cov = keeper.coverage(p);
  const d = distToSegment(cx, cy, cov.ax * reach, cov.ay, cov.bx * reach, cov.by);
  if (d < cov.r + radiusBonus + BALL_R) {
    // parry: ball bounces back out
    Ball.vel.z = Math.abs(Ball.vel.z) * 0.32;
    Ball.vel.x = Math.sign(cx - cov.bx || rand(-1, 1)) * rand(2, 5);
    Ball.vel.y = Math.abs(Ball.vel.y) * 0.3 + 1.5;
    AudioFX.thud();
    camShake = 0.35;
    return 'save';
  }
  Ball.netted = true;
  camShake = 0.55;
  return 'goal';
}

// ---------------------------------------------------------------- keeper mode: the AI takes the kicks
// AI shot placement: mostly corners with pace, occasionally off target for a breather
function aiAim() {
  const offRate = [0.14, 0.11, 0.08][G.stageIdx];
  let x, y;
  if (Math.random() < offRate) { // narrowly off target
    if (Math.random() < 0.6) { x = rand(3.75, 4.4) * (Math.random() < 0.5 ? -1 : 1); y = rand(0.3, 2.1); }
    else { x = rand(-2.5, 2.5); y = rand(2.6, 3.2); }
  } else if (Math.random() < 0.72) { // corners
    x = rand(1.5, 3.0) * (Math.random() < 0.5 ? -1 : 1);
    y = Math.random() < 0.55 ? rand(0.3, 1.0) : rand(1.4, 2.2);
  } else { // through the middle
    x = rand(-1.5, 1.5);
    y = rand(0.3, 1.8);
  }
  const power = [rand(0.4, 0.68), rand(0.5, 0.78), rand(0.58, 0.88)][G.stageIdx];
  return { target: new THREE.Vector3(x, y, 0), power, curve: rand(-0.55, 0.55) };
}

// lean control commits you to a side like a real keeper, so the gloves get generous reach
const PLAYER_REACH = 1.25;
const PLAYER_RADIUS = 0.15;

function aiKick() {
  const myShot = ++shotSeq;
  setTimeout(() => { if (shotSeq === myShot) finishShot('wide'); }, 4000);
  const { target, power, curve } = aiAim();
  AudioFX.kick();
  Ball.kick(target, power, curve);
  G.state = 'defend';
  // brief flash of where the shot is headed — your read-and-react window
  reticle.position.set(clamp(target.x, -4.2, 4.2), clamp(target.y, 0.2, 3), 0.05);
  reticle.visible = true;
  setTimeout(() => { if (G.state === 'defend') reticle.visible = false; }, 300);
  Ball.onCross = (cx, cy, now) => finishShot(resolveCrossing(cx, cy, now, PLAYER_REACH, PLAYER_RADIUS));
}

async function defendRound(token) {
  const alive = () => token === G.matchToken;
  Ball.placeOnSpot();
  keeper.reset();
  striker.reset();
  hideBanner();
  swipe.active = false; // discard any gesture that started before this round
  G.state = 'defend-ready';
  if (!G.firstDiveTaken) {
    el('hint').querySelector('.txt').textContent = 'Hold & lean, release to dive · push up to jump';
    el('hint').classList.remove('hidden');
  }
  await sleep(rand(600, 1300));
  if (!alive()) return null;
  striker.startRun(0.55, performance.now() / 1000);
  await sleep(650); // boot meets ball
  if (!alive()) return null;
  aiKick();
  return new Promise(res => { resolveShot = res; });
}

function finishShot(outcome) {
  shotSeq++; // invalidate this shot's safety timeout
  if (resolveShot) { const r = resolveShot; resolveShot = null; r(outcome); }
}

// ---------------------------------------------------------------- online duel
// Fixed roles per half: the host strikes all of half 1 while the guest keeps,
// then roles swap for half 2; sudden death alternates single kicks. The
// keeper's phone is the referee — it holds both the shot and the dive, so its
// verdict decides the score. The striker's phone replays the dive and ball
// flight locally, which hides the network round-trip inside the celebration.

function sendDiveToOpponent() {
  const d = keeper.dive;
  if (!d || !G.online || G.online.diveSent) return;
  G.online.diveSent = true;
  const msg = { t: 'dive', type: d.type, dirX: d.dirX, side: d.side, targetY: d.targetY, dur: d.dur };
  if (G.online.kickT != null) {
    msg.delay = d.start - G.online.kickT; // seconds after the kick (may be negative for an early guess)
    Net.send(msg);
  } else {
    G.online.pendingDive = { msg, startAbs: d.start }; // dove before the kick arrived; send once we know kick time
  }
}

function onlineStageLabel() {
  const o = G.online;
  const a = o.A.length, b = o.B.length;
  if (a >= 5 && b >= 5) return 'ONLINE DUEL · SUDDEN DEATH';
  return a < 5 ? 'ONLINE DUEL · FIRST HALF' : 'ONLINE DUEL · SECOND HALF';
}

// decision + schedule over the two shooting records (A = host's kicks, B = guest's)
function duelDecision(A, B) {
  const a = A.filter(Boolean).length, b = B.filter(Boolean).length;
  if (A.length >= 5 && B.length <= 5) {
    if (b > a) return 'B';
    if (b + Math.max(0, 5 - B.length) < a) return 'A';
    if (B.length === 5 && A.length === 5 && a !== b) return a > b ? 'A' : 'B';
  }
  if (A.length === B.length && A.length > 5 && a !== b) return a > b ? 'A' : 'B';
  return null;
}
// A kicks all of half 1; then B until level; tied pairs start with A again
const nextKickerIsA = (A, B) => A.length < 5 ? true : B.length >= A.length;

// my shot this round: wait for my swipe, the opponent's verdict settles it
async function onlineKickAsStriker(token) {
  const alive = () => token === G.matchToken;
  Ball.placeOnSpot();
  keeper.reset();
  keeper.playerControlled = false; // the on-screen keeper replays the opponent's dive
  striker.show(false);
  hideBanner();
  G.online.kickT = null;
  G.online.diveSent = false;
  G.state = 'await';
  if (!G.firstShotTaken) {
    el('hint').querySelector('.txt').textContent = 'Swipe to shoot';
    el('hint').classList.remove('hidden');
  }
  const outcome = await new Promise(res => { resolveShot = res; });
  return alive() ? outcome : null;
}

// their shot: their kick params arrive, I defend live, my phone referees
async function onlineKickAsKeeper(token) {
  const alive = () => token === G.matchToken;
  Ball.placeOnSpot();
  keeper.reset();
  keeper.playerControlled = true;
  striker.reset();
  striker.show(true);
  hideBanner();
  G.online.kickT = null;
  G.online.diveSent = false;
  G.online.pendingDive = null;
  G.state = 'defend-ready'; // lean is allowed before the kick — an early commitment
  if (!G.firstDiveTaken) {
    el('hint').querySelector('.txt').textContent = 'Hold & lean, release to dive · push up to jump';
    el('hint').classList.remove('hidden');
  }
  let kick;
  if (G.online.queuedKick) {
    kick = G.online.queuedKick;
    G.online.queuedKick = null;
  } else {
    kick = await new Promise(res => { G.online.kickResolve = res; });
  }
  if (!alive()) return null;

  const myShot = ++shotSeq;
  setTimeout(() => { if (shotSeq === myShot) finishShot('wide'); }, 4000);
  AudioFX.kick();
  striker.startRun(0.06, performance.now() / 1000 - 0.06); // instant strike pose, no run-up delay online
  Ball.kick(new THREE.Vector3(kick.x, kick.y, 0), kick.power, kick.curve);
  G.online.kickT = performance.now() / 1000;
  if (G.online.pendingDive) { // dove early: now we can timestamp it relative to the kick
    const pd = G.online.pendingDive;
    pd.msg.delay = pd.startAbs - G.online.kickT;
    Net.send(pd.msg);
    G.online.pendingDive = null;
  }
  G.state = 'defend';
  reticle.position.set(clamp(kick.x, -4.2, 4.2), clamp(kick.y, 0.2, 3), 0.05);
  reticle.visible = true;
  setTimeout(() => { if (G.state === 'defend') reticle.visible = false; }, 300);
  Ball.onCross = (cx, cy, now) => {
    const verdict = resolveCrossing(cx, cy, now, PLAYER_REACH, PLAYER_RADIUS);
    Net.send({ t: 'outcome', result: verdict }); // I'm the referee for this kick
    finishShot(verdict);
  };
  const outcome = await new Promise(res => { resolveShot = res; });
  return alive() ? outcome : null;
}

async function runOnlineMatch(token) {
  const alive = () => token === G.matchToken;
  const o = G.online;
  o.A = []; o.B = [];
  G.pKicks = []; G.oKicks = []; // pKicks = MY goals when shooting (scoreboard)
  renderScoreboard();
  el('hud').classList.remove('hidden');
  setNetOpacity(1);
  striker.jerseyMat.color.set(G.oppTeam.color === 0xffffff ? G.oppTeam.alt : G.oppTeam.color);
  AudioFX.whistle();

  let prevIShoot = null;
  while (alive()) {
    const kickerIsA = nextKickerIsA(o.A, o.B);
    const iShoot = kickerIsA === (o.hostFirst ? Net.isHost : !Net.isHost);
    el('stage-label').textContent = onlineStageLabel();

    // halftime / role-change presentation
    if (prevIShoot !== null && prevIShoot !== iShoot) {
      showBanner(o.A.length === 5 && o.B.length === 0 ? 'HALF TIME' : 'ROLES SWAP', 'neutral',
        iShoot ? 'You take the kicks now!' : 'Into goal — defend your net!');
      await sleep(1800);
      if (!alive()) return;
      hideBanner();
    }
    if (prevIShoot !== iShoot) {
      G.mode = iShoot ? 'striker' : 'keeper';
      applyCameraMode();
      camLook.set(0, iShoot ? 1.4 : 0.8, iShoot ? 0 : 8);
    }
    prevIShoot = iShoot;

    const kicker = iShoot ? G.playerTeam : G.oppTeam;
    const defender = iShoot ? G.oppTeam : G.playerTeam;
    keeper.jerseyMat.color.set(defender.color === 0xffffff ? defender.alt : defender.color);
    trail.material.color.set(kicker.color === 0xffffff ? kicker.alt : kicker.color);

    const outcome = iShoot ? await onlineKickAsStriker(token) : await onlineKickAsKeeper(token);
    if (!alive()) return;
    G.state = 'between';

    const scored = outcome === 'goal';
    (kickerIsA ? o.A : o.B).push(scored);
    (iShoot ? G.pKicks : G.oKicks).push(scored);
    renderScoreboard();

    if (iShoot) {
      if (scored) {
        showBanner('GOAL!', 'goal', choice(['What a strike!', 'Top bins!', 'Unstoppable!']));
        AudioFX.cheer(); vibrate([40, 40, 60]);
        confetti.burst(Ball.pos.x, 1.6, -1, [G.playerTeam.color, G.playerTeam.alt]);
      } else {
        const msg = { save: 'SAVED!', post: 'OFF THE WOODWORK!', over: 'OVER THE BAR!', wide: 'WIDE!' }[outcome] || 'NO GOAL';
        showBanner(msg, 'bad', outcome === 'save' ? `${G.oppTeam.name} read it!` : 'So close!');
        AudioFX.groan(); vibrate(60);
      }
    } else {
      if (outcome === 'save') {
        showBanner('SUPER SAVE!', 'goal', choice(['What a stop!', 'Fingertips!', 'Denied!']));
        AudioFX.cheer(); vibrate([40, 40, 60]);
        confetti.burst(Ball.pos.x, 1.6, 1, [G.playerTeam.color, G.playerTeam.alt]);
      } else if (scored) {
        showBanner('GOAL CONCEDED', 'bad', 'They found the corner...');
        AudioFX.groan(); vibrate(60);
      } else {
        showBanner({ post: 'OFF THE POST!', over: 'OVER THE BAR!', wide: 'WIDE!' }[outcome] || 'OFF TARGET', 'neutral', 'Let-off!');
        AudioFX.swell(0.3, 0.15, 1.5);
      }
    }
    await sleep(1700);
    if (!alive()) return;

    const decision = duelDecision(o.A, o.B);
    if (decision) return endOnlineMatch(decision);
  }
}

function endOnlineMatch(decision) {
  G.state = 'end';
  el('hint').classList.add('hidden');
  const o = G.online;
  const iAmA = o.hostFirst ? Net.isHost : !Net.isHost;
  const iWin = (decision === 'A') === iAmA;
  const my = G.pKicks.filter(Boolean).length, their = G.oKicks.filter(Boolean).length;
  const emoji = el('end-emoji'), title = el('end-title'), detail = el('end-detail');
  const primary = el('end-primary'), secondary = el('end-secondary');
  emoji.textContent = iWin ? '🏆' : '💔';
  title.textContent = iWin ? 'YOU WIN!' : `${G.oppTeam.name} WINS`;
  title.className = 'result ' + (iWin ? 'win' : 'lose');
  detail.textContent = `${G.playerTeam.flag} ${my} – ${their} ${G.oppTeam.flag}`;
  primary.textContent = 'Rematch';
  primary.onclick = () => {
    o.rematchMe = true;
    Net.send({ t: 'rematch' });
    detail.textContent = 'Waiting for your opponent...';
    maybeStartRematch();
  };
  secondary.onclick = () => { Net.send({ t: 'bye' }); showTitle(); };
  if (iWin) { confetti.burst(0, 2.5, 3, [G.playerTeam.color, G.playerTeam.alt]); AudioFX.cheer(); vibrate([60, 50, 60, 50, 120]); }
  else AudioFX.groan();
  hideBanner();
  el('end-screen').classList.remove('hidden');
}

function maybeStartRematch() {
  const o = G.online;
  if (!o || !o.rematchMe || !o.rematchThem) return;
  o.rematchMe = o.rematchThem = false;
  o.hostFirst = !o.hostFirst; // swap who strikes first each rematch
  hideOverlays();
  beginOnlineMatch();
}

function beginOnlineMatch() {
  G.matchToken++;
  G.state = 'vs';
  G.firstShotTaken = false;
  G.firstDiveTaken = false;
  Ball.placeOnSpot();
  keeper.reset();
  el('vs-stage').textContent = 'ONLINE DUEL';
  el('vs-pflag').textContent = G.playerTeam.flag;
  el('vs-pname').textContent = G.playerTeam.name;
  el('vs-oflag').textContent = G.oppTeam.flag;
  el('vs-oname').textContent = G.oppTeam.name;
  el('vs-screen').classList.remove('hidden');
  // no tap-to-start online: both phones auto-kick-off in sync
  const token = ++G.matchToken;
  setTimeout(() => {
    if (token !== G.matchToken || !G.online) return;
    el('vs-screen').classList.add('hidden');
    runOnlineMatch(token);
  }, 2600);
}

function wireOnlineHandlers() {
  Net.on('hello', m => {
    G.oppTeam = TEAMS[m.team] || TEAMS[0];
    const o = G.online;
    o.gotHello = true;
    if (Net.isHost && !o.started) {
      o.started = true;
      Net.send({ t: 'start', hostFirst: o.hostFirst });
      hideOverlays();
      beginOnlineMatch();
    }
  });
  Net.on('start', m => {
    const o = G.online;
    if (o.started) return;
    o.started = true;
    o.hostFirst = m.hostFirst;
    hideOverlays();
    beginOnlineMatch();
  });
  Net.on('kick', m => {
    if (!G.online) return;
    if (G.online.kickResolve) {
      const r = G.online.kickResolve;
      G.online.kickResolve = null;
      r(m);
    } else G.online.queuedKick = m; // arrived a beat before this round was ready
  });
  Net.on('dive', m => {
    // replay the opponent keeper's dive on my screen, on its original timeline
    if (!G.online || G.online.kickT == null || keeper.dive) return;
    const startAt = G.online.kickT + (m.delay || 0);
    if (m.type === 'jump') keeper.startJump(m.dur, startAt);
    else keeper.startDive(m.dirX, m.targetY, m.dur, startAt);
  });
  Net.on('outcome', m => {
    if (!G.online) return;
    G.online.remoteOutcome = m.result;
    if (G.online.crossed) finishShot(m.result); // referee's verdict settles my kick
  });
  Net.on('rematch', () => {
    if (!G.online) return;
    G.online.rematchThem = true;
    maybeStartRematch();
  });
  Net.on('bye', () => Net._lost());
  Net.onLost = () => {
    if (!G.online) return;
    G.online = null;
    hideOverlays();
    el('hud').classList.add('hidden');
    el('net-lost').classList.remove('hidden');
  };
}

// ---- lobby wiring
function showOnlineLobby() {
  G.state = 'lobby';
  el('mode-screen').classList.add('hidden');
  el('lobby-home').classList.remove('hidden');
  el('lobby-wait').classList.add('hidden');
  el('online-screen').classList.remove('hidden');
}

function startOnlineAs(host, code) {
  G.online = { hostFirst: true, started: false, gotHello: false, rematchMe: false, rematchThem: false };
  wireOnlineHandlers();
  Net.onOpen = () => {
    el('lobby-status').textContent = 'Opponent connected!';
    Net.send({ t: 'hello', team: TEAMS.indexOf(G.playerTeam) });
  };
  const status = s => { el('lobby-status').textContent = s; };
  el('lobby-home').classList.add('hidden');
  el('lobby-wait').classList.remove('hidden');
  if (host) {
    el('room-code').textContent = code;
    el('btn-share').classList.remove('hidden');
    Net.create(code, status);
    status('Waiting for your opponent...');
  } else {
    el('room-code').textContent = code;
    el('btn-share').classList.add('hidden');
    Net.join(code, status);
    status('Connecting...');
  }
}

(function wireLobbyUI() {
  el('btn-create').addEventListener('click', () => startOnlineAs(true, Net.makeCode()));
  el('btn-join').addEventListener('click', () => {
    const code = el('join-code').value.trim().toUpperCase();
    if (code.length >= 4 || Net.loopParam()) startOnlineAs(false, code || 'LOOP');
  });
  el('btn-share').addEventListener('click', () => {
    const code = el('room-code').textContent;
    const url = location.origin + location.pathname + '?room=' + code;
    if (navigator.share) navigator.share({ title: "Robel's World Cup Striker", text: 'Penalty duel — I shoot, you save. Join me!', url }).catch(() => {});
    else navigator.clipboard && navigator.clipboard.writeText(url).then(() => { el('lobby-status').textContent = 'Link copied!'; });
  });
  el('btn-lobby-back').addEventListener('click', () => {
    Net.close();
    G.online = null;
    el('online-screen').classList.add('hidden');
    el('mode-screen').classList.remove('hidden');
    G.state = 'title';
  });
  el('btn-net-menu').addEventListener('click', () => showTitle());
})();

// ---------------------------------------------------------------- match flow
// quick simulated cutaway for whichever side you're not playing
async function simKickRound(token, isPlayerTeam) {
  const alive = () => token === G.matchToken;
  hideBanner();
  const team = isPlayerTeam ? G.playerTeam : G.oppTeam;
  const card = el('opp-card');
  el('opp-overlay').classList.remove('hidden', 'show');
  card.textContent = `${team.flag} ${team.name} step${isPlayerTeam ? '' : 's'} up...`;
  el('opp-overlay').classList.add('show');
  AudioFX.swell(0.16, 0.5, 0.8);
  await sleep(1200);
  if (!alive()) return;
  const scores = Math.random() < (isPlayerTeam ? [0.74, 0.72, 0.70][G.stageIdx] : STAGES[G.stageIdx].oppRate);
  (isPlayerTeam ? G.pKicks : G.oKicks).push(scores);
  renderScoreboard();
  if (isPlayerTeam) {
    card.textContent = scores ? `${team.flag} GOAL! 🎉` : `😖 Their keeper saves it!`;
    if (scores) { AudioFX.cheer(); vibrate([30, 30, 30]); } else AudioFX.groan();
  } else {
    card.textContent = scores ? `${team.flag} GOAL 😖` : `🧤 YOUR KEEPER SAVES IT!`;
    if (scores) AudioFX.groan(); else { AudioFX.cheer(); vibrate([30, 30, 30]); }
  }
  await sleep(1300);
  if (!alive()) return;
  el('opp-overlay').classList.remove('show');
  await sleep(200);
  el('opp-overlay').classList.add('hidden');
}

async function runMatch(token) {
  const alive = () => token === G.matchToken;
  const keeperMode = G.mode === 'keeper';
  G.pKicks = []; G.oKicks = [];
  renderScoreboard();
  el('hud').classList.remove('hidden');
  el('stage-label').textContent = STAGES[G.stageIdx].name;
  // in keeper mode YOU are the keeper (your colors); the striker wears theirs
  keeper.jerseyMat.color.set(keeperMode
    ? (G.playerTeam.color === 0xffffff ? G.playerTeam.alt : G.playerTeam.color)
    : G.oppTeam.alt);
  striker.show(keeperMode);
  keeper.playerControlled = keeperMode;
  striker.jerseyMat.color.set(G.oppTeam.color === 0xffffff ? G.oppTeam.alt : G.oppTeam.color);
  const shooter = keeperMode ? G.oppTeam : G.playerTeam;
  trail.material.color.set(shooter.color === 0xffffff ? shooter.alt : shooter.color);
  setNetOpacity(1); // the tight keeper cam sits above the net drape, so keep it fully visible
  AudioFX.whistle();

  while (alive()) {
    if (keeperMode) {
      // ----- opponent kick: you defend it live
      const outcome = await defendRound(token);
      if (!alive()) return;
      G.state = 'between';
      G.oKicks.push(outcome === 'goal');
      renderScoreboard();
      if (outcome === 'save') {
        showBanner('SUPER SAVE!', 'goal', choice(['What a stop!', 'Fingertips!', 'Denied!', 'Safe hands!']));
        AudioFX.cheer();
        vibrate([40, 40, 60]);
        confetti.burst(Ball.pos.x, 1.6, 1, [G.playerTeam.color, G.playerTeam.alt]);
      } else if (outcome === 'goal') {
        showBanner('GOAL CONCEDED', 'bad', 'They found the corner...');
        AudioFX.groan();
        vibrate(60);
      } else {
        showBanner({ post: 'OFF THE POST!', over: 'OVER THE BAR!', wide: 'WIDE!' }[outcome], 'neutral', 'It stays level!');
        AudioFX.swell(0.3, 0.15, 1.5);
      }
      await sleep(1500);
      if (!alive()) return;
      let result = shootoutResult();
      if (result) return endMatch(result);

      // ----- your team's kick (quick simulated cutaway)
      if (G.pKicks.length < G.oKicks.length) {
        await simKickRound(token, true);
        if (!alive()) return;
        result = shootoutResult();
        if (result) return endMatch(result);
      }
    } else {
      // ----- player kick
      Ball.placeOnSpot();
      keeper.reset();
      hideBanner();
      G.state = 'await';
      if (!G.firstShotTaken) {
        el('hint').querySelector('.txt').textContent = 'Swipe to shoot';
        el('hint').classList.remove('hidden');
      }
      const outcome = await new Promise(res => { resolveShot = res; }); // resolved via takeShot→finishShot
      if (!alive()) return;

      const scored = outcome === 'goal';
      G.pKicks.push(scored);
      renderScoreboard();
      if (scored) {
        showBanner('GOAL!', 'goal', choice(['What a strike!', 'Top bins!', 'Cool as ice!', 'Unstoppable!']));
        AudioFX.cheer();
        vibrate([40, 40, 60]);
        confetti.burst(Ball.pos.x, 1.6, -1, [G.playerTeam.color, G.playerTeam.alt]);
      } else {
        const msg = { save: 'SAVED!', post: 'OFF THE WOODWORK!', over: 'OVER THE BAR!', wide: 'WIDE!' }[outcome];
        showBanner(msg, 'bad', outcome === 'save' ? 'The keeper read it!' : 'So close!');
        AudioFX.groan();
        vibrate(60);
      }
      await sleep(1500);
      if (!alive()) return;

      let result = shootoutResult();
      if (result) return endMatch(result);

      // ----- opponent kick (quick simulated cutaway)
      if (G.oKicks.length < G.pKicks.length) {
        await simKickRound(token, false);
        if (!alive()) return;
        result = shootoutResult();
        if (result) return endMatch(result);
      }
    }
  }
}

function endMatch(result) {
  G.state = 'end';
  el('hint').classList.add('hidden');
  const p = G.pKicks.filter(Boolean).length, o = G.oKicks.filter(Boolean).length;
  const isFinal = G.stageIdx === STAGES.length - 1;
  const endEl = el('end-screen');
  const title = el('end-title'), emoji = el('end-emoji'), detail = el('end-detail');
  const primary = el('end-primary'), secondary = el('end-secondary');

  if (result === 'win' && isFinal) {
    emoji.textContent = '🏆';
    title.textContent = 'WORLD CHAMPIONS!';
    title.className = 'result win';
    detail.textContent = `${G.playerTeam.flag} ${G.playerTeam.name} win the World Cup ${p}–${o}!`;
    primary.textContent = 'Play again';
    primary.onclick = () => { hideOverlays(); showTitle(); };
    confetti.burst(0, 3, 4, [G.playerTeam.color, 0xffd75e]);
    AudioFX.cheer();
    vibrate([60, 50, 60, 50, 120]);
  } else if (result === 'win') {
    emoji.textContent = '🎉';
    title.textContent = 'YOU WIN!';
    title.className = 'result win';
    detail.textContent = `${p}–${o} · ${G.playerTeam.name} advance to the ${STAGES[G.stageIdx + 1].name.toLowerCase()}!`;
    primary.textContent = 'Next match';
    primary.onclick = () => {
      hideOverlays();
      G.stageIdx++;
      G.oppTeam = G.opponents[G.stageIdx];
      showVs();
    };
    confetti.burst(0, 2.5, 3, [G.playerTeam.color, G.playerTeam.alt]);
    AudioFX.cheer();
  } else {
    emoji.textContent = '💔';
    title.textContent = 'ELIMINATED';
    title.className = 'result lose';
    detail.textContent = `${G.oppTeam.flag} ${G.oppTeam.name} knock you out ${o}–${p}.`;
    primary.textContent = 'Try again';
    primary.onclick = () => { hideOverlays(); showVs(); }; // rematch the same stage
    AudioFX.groan();
  }
  secondary.onclick = () => { hideOverlays(); showTitle(); };
  hideBanner();
  el('opp-overlay').classList.add('hidden');
  endEl.classList.remove('hidden');
}

function hideOverlays() {
  for (const id of ['title-screen', 'mode-screen', 'vs-screen', 'end-screen', 'hint',
    'online-screen', 'net-lost']) el(id).classList.add('hidden');
  el('opp-overlay').classList.add('hidden');
  hideBanner();
}

function showTitle() {
  G.matchToken++;
  G.state = 'title';
  G.mode = 'striker'; // title screen uses the behind-the-spot camera
  Net.close();
  G.online = null;
  hideOverlays();
  el('hud').classList.add('hidden');
  Ball.placeOnSpot();
  keeper.reset();
  keeper.playerControlled = false;
  striker.show(false);
  applyCameraMode();
  camLook.set(0, 1.4, 0);
  el('title-screen').classList.remove('hidden');
}

function showVs() {
  G.matchToken++;
  G.state = 'vs';
  Ball.placeOnSpot();
  keeper.reset();
  striker.reset();
  applyCameraMode();
  camLook.set(0, 1.4, G.mode === 'keeper' ? 8 : 0);
  el('vs-stage').textContent = STAGES[G.stageIdx].name;
  el('vs-pflag').textContent = G.playerTeam.flag;
  el('vs-pname').textContent = G.playerTeam.name;
  el('vs-oflag').textContent = G.oppTeam.flag;
  el('vs-oname').textContent = G.oppTeam.name;
  el('vs-screen').classList.remove('hidden');
  // start on pointerUP so the kickoff tap's release can't register as a dive/shot input
  const start = () => {
    el('vs-screen').removeEventListener('pointerup', start);
    el('vs-screen').classList.add('hidden');
    G.matchToken++;
    runMatch(G.matchToken);
  };
  el('vs-screen').addEventListener('pointerup', start);
}

function pickTeam(team) {
  AudioFX.init();
  G.playerTeam = team;
  el('title-screen').classList.add('hidden');
  if (inviteRoom && !G.online) { // arrived via an invite link: join straight away
    showOnlineLobby();
    startOnlineAs(false, inviteRoom.toUpperCase());
    return;
  }
  el('mode-screen').classList.remove('hidden');
}

function startTournament(mode) {
  G.mode = mode;
  G.stageIdx = 0;
  G.firstShotTaken = false;
  G.firstDiveTaken = false;
  const pool = TEAMS.filter(t => t !== G.playerTeam);
  G.opponents = [];
  while (G.opponents.length < STAGES.length) {
    const t = choice(pool);
    if (!G.opponents.includes(t)) G.opponents.push(t);
  }
  G.oppTeam = G.opponents[0];
  hideOverlays();
  showVs();
}

// build the team-select grid + mode buttons
(function buildTeamGrid() {
  const grid = el('team-grid');
  for (const team of TEAMS) {
    const d = document.createElement('div');
    d.className = 'team';
    d.innerHTML = `<span class="flag">${team.flag}</span><span class="name">${team.name}</span>`;
    d.addEventListener('pointerdown', () => pickTeam(team));
    grid.appendChild(d);
  }
  el('mode-striker').addEventListener('pointerdown', () => startTournament('striker'));
  el('mode-keeper').addEventListener('pointerdown', () => startTournament('keeper'));
  el('mode-online').addEventListener('pointerdown', () => showOnlineLobby());
})();

// invite links (?room=CODE) jump straight into joining after the team pick
const inviteRoom = new URLSearchParams(location.search).get('room');

// ---------------------------------------------------------------- resize & render loop
// per-mode camera home position; narrow portrait pulls back so the goal always fits
function camBase() {
  const squeeze = camera.aspect < 0.62 ? (0.62 - camera.aspect) : 0;
  return G.mode === 'keeper'
    ? new THREE.Vector3(0, 3.6, -7.4 - squeeze * 3) // tight behind the net: ~65% of the goal during the buildup
    : new THREE.Vector3(0, 2.3, SPOT_Z + 4.6 + squeeze * 6);
}

// keeper mode uses a wider lens so the whole goal fits on a portrait screen
function applyCameraMode() {
  camera.fov = G.mode === 'keeper' ? 68 : 58;
  camera.updateProjectionMatrix();
  camera.position.copy(camBase());
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
onResize();

let lastT = performance.now() / 1000;

// keep the simulation honest even when rAF stalls (hidden/backgrounded tab):
// catch up in fixed substeps so online verdicts still resolve on time
function stepSim(dt, now) {
  Ball.update(dt, now);
  keeper.update(now, dt);
  striker.update(now, dt);
  confetti.update(dt);
}
setInterval(() => {
  const now = performance.now() / 1000;
  if (now - lastT > 0.2) {
    let t = lastT;
    while (t < now - 0.03) {
      t = Math.min(t + 0.033, now);
      stepSim(0.033, t);
    }
    lastT = now;
  }
}, 120);

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = clamp(now - lastT, 0.001, 0.05);
  lastT = now;

  Ball.update(dt, now);
  keeper.update(now, dt);
  striker.update(now, dt);
  confetti.update(dt);

  // reticle pulse
  if (reticle.visible) {
    const s = 1 + Math.sin(now * 10) * 0.12;
    reticle.scale.set(s, s, 1);
  }

  // camera: subtle push-in on the shot, follow the ball a little, shake on impact
  camPush = Math.max(0, camPush - dt * 1.4);
  camShake = Math.max(0, camShake - dt * 2.2);
  const base = camBase();
  const keeperCam = G.mode === 'keeper';
  let followX;
  if (keeperCam) {
    // pan with the keeper's lean and dive, plus a touch of ball tracking
    followX = keeper.group.position.x * 0.75 + (Ball.flying ? Ball.pos.x * 0.1 : 0);
    // pull back the moment the action explodes so the whole goal is in frame
    const backTarget = (keeper.dive || Ball.flying) ? 4.4 : 0;
    camBack = lerp(camBack, backTarget, Math.min(1, dt * 5));
  } else {
    followX = Ball.flying ? Ball.pos.x * 0.18 : 0;
    camBack = 0;
  }
  camera.position.x = lerp(camera.position.x, followX + (Math.random() - 0.5) * camShake * 0.3, 0.12);
  camera.position.y = base.y + (Math.random() - 0.5) * camShake * 0.25;
  camera.position.z = lerp(camera.position.z, base.z + (keeperCam ? -camBack : -camPush * 1.4), 0.09);
  camLook.set(
    lerp(camLook.x, Ball.flying ? Ball.pos.x * 0.35 : 0, 0.1),
    lerp(camLook.y, Ball.flying ? clamp(Ball.pos.y * 0.5 + 0.9, keeperCam ? 0.7 : 1.1, 1.9) : (keeperCam ? 0.8 : 1.4), 0.1),
    keeperCam ? 8 : 0 // keeper cam looks up the pitch toward the spot
  );
  camera.lookAt(camLook);

  renderer.render(scene, camera);
}
Ball.placeOnSpot();
frame();
