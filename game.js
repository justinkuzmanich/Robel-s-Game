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
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), frameMat);
    back.position.set(s * GOAL_W, GOAL_H / 2 - 0.1, -1.1);
    back.rotation.x = Math.PI / 2.6;
    scene.add(back);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(POST_R, POST_R, GOAL_W * 2 + POST_R * 2, 10), frameMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, GOAL_H, 0);
  scene.add(bar);

  const netTex = makeCanvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.5;
    for (let i = 0; i <= 16; i++) {
      g.beginPath(); g.moveTo((i / 16) * w, 0); g.lineTo((i / 16) * w, h); g.stroke();
      g.beginPath(); g.moveTo(0, (i / 16) * h); g.lineTo(w, (i / 16) * h); g.stroke();
    }
  });
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
  const netMat = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const netPanel = (w, h, rx, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), netMat.clone());
    m.material.map = netTex.clone();
    m.material.map.repeat.set(w / 0.9, h / 0.9);
    m.rotation.x = rx || 0; m.rotation.y = ry || 0;
    scene.add(m);
    return m;
  };
  const panels = [
    netPanel(GOAL_W * 2, GOAL_H),                    // back
    netPanel(GOAL_W * 2, 2.0, -Math.PI / 2.35),      // roof
    netPanel(2.0, GOAL_H, 0, Math.PI / 2),           // sides
    netPanel(2.0, GOAL_H, 0, Math.PI / 2),
  ];
  panels[0].position.set(0, GOAL_H / 2 - 0.15, -1.9);
  panels[1].position.set(0, GOAL_H - 0.35, -0.95);
  panels[2].position.set(-GOAL_W, GOAL_H / 2 - 0.1, -0.95);
  panels[3].position.set(GOAL_W, GOAL_H / 2 - 0.1, -0.95);
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

// ---- low-poly goalkeeper
const keeper = (function () {
  const group = new THREE.Group();
  const jersey = new THREE.MeshLambertMaterial({ color: 0xff8c1a });
  const skin = new THREE.MeshLambertMaterial({ color: 0xd9a06b });
  const dark = new THREE.MeshLambertMaterial({ color: 0x15181e });
  const glove = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });

  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.17, 0.8, 0.2), dark, s * 0.14, 0.4, 0);
  add(new THREE.BoxGeometry(0.5, 0.3, 0.26), dark, 0, 0.9, 0);
  const torso = add(new THREE.BoxGeometry(0.56, 0.62, 0.3), jersey, 0, 1.34, 0);
  add(new THREE.SphereGeometry(0.16, 12, 10), skin, 0, 1.83, 0);
  add(new THREE.BoxGeometry(0.34, 0.1, 0.34), dark, 0, 1.95, 0); // cap
  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.33, 1.58, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.62, 0.13), jersey);
    arm.position.y = -0.28;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), glove);
    hand.position.y = -0.62;
    pivot.add(arm, hand);
    pivot.rotation.z = s * 0.5; // ready stance, arms out
    group.add(pivot);
    arms.push(pivot);
  }
  group.position.set(0, 0, 0.25);
  scene.add(group);

  return {
    group, arms,
    jerseyMat: jersey,
    dive: null, // {dirX, targetY, start, dur}
    idleT: 0,
    reset() {
      this.dive = null;
      group.position.set(0, 0, 0.25);
      group.rotation.set(0, 0, 0);
      arms[0].rotation.z = -0.5;
      arms[1].rotation.z = 0.5;
    },
    startDive(dirX, targetY, dur) {
      this.dive = { dirX, targetY, start: performance.now() / 1000, dur, side: Math.sign(dirX) || (Math.random() < 0.5 ? 1 : -1) };
    },
    progress(now) {
      if (!this.dive) return 0;
      return clamp((now - this.dive.start) / this.dive.dur, 0, 1);
    },
    // analytic coverage used by the save check: a thick segment from hip to gloves
    coverage(p) {
      if (!this.dive || this.dive.dirX === 0) {
        return { ax: 0, ay: 0.3, bx: 0, by: 2.0, r: 0.5 };
      }
      const d = this.dive;
      const handX = d.side * (0.35 + 1.75 * p); // corners stay beatable even on a correct guess
      const handY = clamp(lerp(1.7, d.targetY, p), 0.25, 2.35);
      const hipX = d.side * (0.15 + 0.95 * p);
      const hipY = lerp(0.95, Math.max(0.45, d.targetY * 0.45), p);
      return { ax: hipX, ay: hipY, bx: handX, by: handY, r: 0.45 };
    },
    update(now, dt) {
      if (this.dive && this.dive.dirX === 0) { // standing his ground: arms up, small hop
        const p = this.progress(now);
        const e = 1 - Math.pow(1 - p, 2.2);
        group.position.x = lerp(group.position.x, 0, 0.3);
        group.position.y = Math.sin(Math.min(p, 1) * Math.PI) * 0.22;
        arms[0].rotation.z = lerp(-0.5, -2.7, e);
        arms[1].rotation.z = lerp(0.5, 2.7, e);
      } else if (this.dive) {
        const p = this.progress(now);
        const e = 1 - Math.pow(1 - p, 2.2); // ease-out
        const d = this.dive;
        group.position.x = d.side * 1.55 * e;
        group.position.y = Math.sin(Math.min(p, 1) * Math.PI) * clamp(d.targetY - 0.6, 0.05, 0.85);
        group.rotation.z = -d.side * lerp(0, clamp(1.55 - d.targetY * 0.3, 0.9, 1.5), e);
        arms[d.side > 0 ? 1 : 0].rotation.z = d.side * lerp(0.5, 2.6, e);
        arms[d.side > 0 ? 0 : 1].rotation.z = -d.side * lerp(0.5, 1.4, e);
      } else {
        // idle: sway side to side, tiny bounce
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
  const group = new THREE.Group();
  const jersey = new THREE.MeshLambertMaterial({ color: 0x3f6cff });
  const dark = new THREE.MeshLambertMaterial({ color: 0x15181e });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc98d5f });
  const add = (geo, mat, x, y, z, parent) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    (parent || group).add(m);
    return m;
  };
  add(new THREE.BoxGeometry(0.16, 0.78, 0.16), dark, -0.12, 0.39, 0);
  const kickHip = new THREE.Group(); // pivot so the strike leg can swing
  kickHip.position.set(0.13, 0.82, 0);
  add(new THREE.BoxGeometry(0.16, 0.78, 0.16), dark, 0, -0.39, 0, kickHip);
  group.add(kickHip);
  add(new THREE.BoxGeometry(0.46, 0.28, 0.24), dark, 0, 0.92, 0);
  add(new THREE.BoxGeometry(0.52, 0.58, 0.28), jersey, 0, 1.32, 0);
  add(new THREE.SphereGeometry(0.15, 12, 10), skin, 0, 1.78, 0);
  for (const s of [-1, 1]) {
    const arm = add(new THREE.BoxGeometry(0.12, 0.56, 0.12), jersey, s * 0.35, 1.28, 0);
    arm.rotation.z = s * 0.35;
  }
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

// ---------------------------------------------------------------- game state
const G = {
  state: 'title',      // title | vs | await | flight | defend-ready | defend | duel | duel-flight | between | end
  mode: 'striker',     // striker | keeper (camera / solo role)
  mp: null,            // null (solo) | 'pass' | 'split' — in 2P, playerTeam is P1 and oppTeam is P2
  duelDive: null,      // pass & play: the keeper's secret pick for the current kick
  playerTeam: null,
  oppTeam: null,
  opponents: [],
  stageIdx: 0,
  pKicks: [], oKicks: [], // arrays of booleans per taken kick
  matchToken: 0,
  firstShotTaken: false,
  firstDiveTaken: false,
};

let camShake = 0;
let camPush = 0;

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

// ---------------------------------------------------------------- input
// multi-pointer tracking: solo modes use one gesture, split-screen tracks
// the shooter (bottom zone) and keeper (top zone) at the same time.
const touches = new Map(); // pointerId -> {zone, points}
const SPLIT_Y = () => window.innerHeight * 0.45;
const hasAimPointer = () => [...touches.values()].some(t => t.zone === 'aim');

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

function aimFromSwipe(pts) {
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

// which input role a fresh touch takes, given where it starts and the game state
function zoneForPointer(e) {
  if (G.state === 'await') return hasAimPointer() ? null : 'aim';
  if (canDive()) return 'dive-solo';
  if (G.state === 'duel') {
    if (e.clientY < SPLIT_Y()) return keeper.dive ? null : 'dive-duel';
    return hasAimPointer() ? null : 'aim';
  }
  if (G.state === 'duel-flight') { // ball already struck: keeper can still react
    return e.clientY < SPLIT_Y() && !keeper.dive ? 'dive-duel' : null;
  }
  return null;
}

function doDive(pts, invertX, dur) {
  if (keeper.dive) return;
  const first = pts[0], last = pts[pts.length - 1];
  const dx = last.x - first.x, dy = first.y - last.y;
  vibrate(20);
  if (Math.hypot(dx, dy) < window.innerHeight * 0.03) {
    keeper.startDive(0, 1.0, dur); // tap: stand tall in the middle
  } else {
    const side = (dx > 0 ? 1 : -1) * (invertX ? -1 : 1);
    const targetY = clamp(0.5 + (dy / (window.innerHeight * 0.28)) * 1.7, 0.3, 2.3);
    keeper.startDive(side, targetY, dur);
  }
}

function onPointerDown(e) {
  const zone = zoneForPointer(e);
  if (!zone) return;
  touches.set(e.pointerId, { zone, points: [{ x: e.clientX, y: e.clientY, t: performance.now() }] });
}
function onPointerMove(e) {
  const t = touches.get(e.pointerId);
  if (!t) return;
  t.points.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  if (t.points.length > 64) t.points.shift();
  if (t.zone !== 'aim') return;
  // live aim reticle uses the same mapping as the shot itself
  const a = aimTarget(t.points[0], { x: e.clientX, y: e.clientY });
  reticle.visible = true;
  reticle.position.set(a.x, a.y, 0.05);
}
function onPointerUp(e) {
  const t = touches.get(e.pointerId);
  if (!t) return;
  touches.delete(e.pointerId);
  const pts = t.points;
  if (t.zone === 'aim') {
    reticle.visible = false;
    if (G.state !== 'await' && G.state !== 'duel') return;
    if (pts.length < 3) return;
    const first = pts[0], last = pts[pts.length - 1];
    if (first.y - last.y < window.innerHeight * 0.04) return; // must swipe upward
    takeShot(aimFromSwipe(pts));
  } else if (t.zone === 'dive-solo' && canDive()) {
    G.firstDiveTaken = true;
    el('hint').classList.add('hidden');
    doDive(pts, true, 0.36); // solo keeper cam faces the pitch: screen-left is world +x
  } else if (t.zone === 'dive-duel' && (G.state === 'duel' || G.state === 'duel-flight')) {
    doDive(pts, false, 0.4); // striker cam: screen-right is world +x
  }
}
window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);

// ---------------------------------------------------------------- shot resolution
let resolveShot = null; // promise resolver for the in-flight shot
let shotSeq = 0;

const MP_REACH = 1.22;      // human keeper reach in 2-player duels
const MP_RADIUS = 0.1;

function takeShot({ target, power, curve }) {
  G.state = G.mp === 'split' ? 'duel-flight' : 'flight';
  const myShot = ++shotSeq;
  setTimeout(() => { if (shotSeq === myShot) finishShot('wide'); }, 4000); // never leave the match loop hanging
  G.firstShotTaken = true;
  el('hint').classList.add('hidden');
  AudioFX.kick();
  vibrate(25);
  camPush = 1;

  Ball.kick(target, power, curve);

  if (!G.mp) {
    // solo: the AI keeper reads the shot (scaled by stage skill, easier on slow shots)
    const stage = STAGES[G.stageIdx];
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
    return;
  }

  if (G.mp === 'pass' && G.duelDive) {
    // pass & play: the defending player's secret pick plays out
    const d = G.duelDive;
    const diveDur = Math.max(0.55, Ball.flightTime - 0.08);
    setTimeout(() => keeper.startDive(d.side, d.y, diveDur), 100);
  }
  // split screen: the defending player dives live via the top input zone
  Ball.onCross = (cx, cy, now) => finishShot(resolveCrossing(cx, cy, now, MP_REACH, MP_RADIUS));
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

const PLAYER_REACH = 1.3;   // your gloves stretch further than the AI keeper's
const PLAYER_RADIUS = 0.18; // plus a forgiveness margin around your dive line

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
  touches.clear(); // discard any gesture that started before this round
  G.state = 'defend-ready';
  if (!G.firstDiveTaken) {
    el('hint').querySelector('.txt').textContent = 'Swipe to dive';
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

// ---------------------------------------------------------------- 2-player duels
let zoneResolve = null;
(function wireZoneButtons() {
  for (const b of document.querySelectorAll('.zone')) {
    b.addEventListener('pointerup', () => {
      if (!zoneResolve) return;
      const r = zoneResolve;
      zoneResolve = null;
      vibrate(15);
      r({ side: +b.dataset.side, y: +b.dataset.y });
    });
  }
})();

function awaitTap(elId) {
  return new Promise(res => {
    const node = el(elId);
    const h = () => { node.removeEventListener('pointerup', h); res(); };
    node.addEventListener('pointerup', h);
  });
}

async function duelKick(token, p1Shoots) {
  const alive = () => token === G.matchToken;
  const kicker = p1Shoots ? G.playerTeam : G.oppTeam;
  const defender = p1Shoots ? G.oppTeam : G.playerTeam;
  Ball.placeOnSpot();
  keeper.reset();
  hideBanner();
  touches.clear();
  G.duelDive = null;
  keeper.jerseyMat.color.set(defender.color === 0xffffff ? defender.alt : defender.color);
  trail.material.color.set(kicker.color === 0xffffff ? kicker.alt : kicker.color);

  if (G.mp === 'pass') {
    // keeper picks a corner in secret, then the phone is handed to the shooter
    el('zone-sub').innerHTML = `${defender.flag} ${defender.name} — choose where you'll dive.<br>${kicker.name}, no peeking!`;
    el('zone-overlay').classList.remove('hidden');
    G.duelDive = await new Promise(res => { zoneResolve = res; });
    if (!alive()) return null;
    el('zone-overlay').classList.add('hidden');
    el('handoff-title').textContent = `${kicker.flag} ${kicker.name}'S KICK`;
    el('handoff-overlay').classList.remove('hidden');
    await awaitTap('handoff-overlay');
    if (!alive()) return null;
    el('handoff-overlay').classList.add('hidden');
    G.state = 'await';
  } else {
    // split screen: label the zones and let both players play live
    el('sd-keeper').textContent = `🧤 ${defender.flag} ${defender.name} — swipe up here to dive`;
    el('sd-shooter').textContent = `⚽ ${kicker.flag} ${kicker.name} — flick up here to shoot`;
    el('split-divider').classList.remove('hidden');
    G.state = 'duel';
  }
  if (!G.firstShotTaken) {
    el('hint').querySelector('.txt').textContent = 'Swipe to shoot';
    el('hint').classList.remove('hidden');
  }
  const outcome = await new Promise(res => { resolveShot = res; });
  if (!alive()) return null;
  G.state = 'between';
  el('split-divider').classList.add('hidden');

  const scored = outcome === 'goal';
  (p1Shoots ? G.pKicks : G.oKicks).push(scored);
  renderScoreboard();
  if (scored) {
    showBanner('GOAL!', 'goal', `${kicker.flag} ${kicker.name} ${choice(['buries it!', 'finds the corner!', 'makes no mistake!'])}`);
    AudioFX.cheer();
    vibrate([40, 40, 60]);
    confetti.burst(Ball.pos.x, 1.6, -1, [kicker.color, kicker.alt]);
  } else if (outcome === 'save') {
    showBanner('SAVED!', 'neutral', `${defender.flag} ${defender.name} ${choice(['reads it!', 'says no!', 'stands tall!'])}`);
    AudioFX.cheer();
    vibrate([30, 30, 30]);
    confetti.burst(Ball.pos.x, 1.6, 1, [defender.color, defender.alt]);
  } else {
    const msg = { post: 'OFF THE WOODWORK!', over: 'OVER THE BAR!', wide: 'WIDE!' }[outcome];
    showBanner(msg, 'bad', 'What a let-off!');
    AudioFX.groan();
    vibrate(60);
  }
  await sleep(1500);
  return outcome;
}

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
  el('stage-label').textContent = G.mp ? '2-PLAYER SHOWDOWN' : STAGES[G.stageIdx].name;

  if (G.mp) { // 2-player duel: P1 shoots at P2's keeper, then roles swap
    striker.show(false);
    setNetOpacity(1);
    AudioFX.whistle();
    while (alive()) {
      let outcome = await duelKick(token, true);
      if (!alive()) return;
      let result = shootoutResult();
      if (result) return endMatch(result);
      if (G.oKicks.length < G.pKicks.length) {
        outcome = await duelKick(token, false);
        if (!alive()) return;
        result = shootoutResult();
        if (result) return endMatch(result);
      }
    }
    return;
  }

  // in keeper mode YOU are the keeper (your colors); the striker wears theirs
  keeper.jerseyMat.color.set(keeperMode
    ? (G.playerTeam.color === 0xffffff ? G.playerTeam.alt : G.playerTeam.color)
    : G.oppTeam.alt);
  striker.show(keeperMode);
  striker.jerseyMat.color.set(G.oppTeam.color === 0xffffff ? G.oppTeam.alt : G.oppTeam.color);
  const shooter = keeperMode ? G.oppTeam : G.playerTeam;
  trail.material.color.set(shooter.color === 0xffffff ? shooter.alt : shooter.color);
  setNetOpacity(keeperMode ? 0.35 : 1); // the keeper cam looks through the net — keep it subtle
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
  el('split-divider').classList.add('hidden');
  const p = G.pKicks.filter(Boolean).length, o = G.oKicks.filter(Boolean).length;
  const isFinal = G.stageIdx === STAGES.length - 1;
  const endEl = el('end-screen');
  const title = el('end-title'), emoji = el('end-emoji'), detail = el('end-detail');
  const primary = el('end-primary'), secondary = el('end-secondary');

  if (G.mp) { // 2-player duel: crown the winner, offer a rematch
    const winner = result === 'win' ? G.playerTeam : G.oppTeam;
    emoji.textContent = '🏆';
    title.textContent = `${winner.name} WINS!`;
    title.className = 'result win';
    detail.textContent = `${winner.flag} takes the shootout ${Math.max(p, o)}–${Math.min(p, o)}`;
    primary.textContent = 'Rematch';
    primary.onclick = () => { hideOverlays(); showVs(); };
    secondary.onclick = () => { hideOverlays(); showTitle(); };
    confetti.burst(0, 2.5, 3, [winner.color, winner.alt]);
    AudioFX.cheer();
    vibrate([60, 50, 60, 50, 120]);
    hideBanner();
    el('opp-overlay').classList.add('hidden');
    endEl.classList.remove('hidden');
    return;
  }

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
    'zone-overlay', 'handoff-overlay', 'split-divider']) el(id).classList.add('hidden');
  el('opp-overlay').classList.add('hidden');
  hideBanner();
}

function showTitle() {
  G.matchToken++;
  G.state = 'title';
  G.mode = 'striker'; // title screen uses the behind-the-spot camera
  G.mp = null;
  pickingFor = 1;
  zoneResolve = null;
  el('title-kicker').textContent = '⚽ Penalty Shootout';
  el('title-sub').textContent = 'Pick your nation. Win the cup.';
  hideOverlays();
  el('hud').classList.add('hidden');
  Ball.placeOnSpot();
  keeper.reset();
  striker.show(false);
  setNetOpacity(1);
  camera.position.copy(camBase());
  camLook.set(0, 1.4, 0);
  el('title-screen').classList.remove('hidden');
}

function showVs() {
  G.matchToken++;
  G.state = 'vs';
  Ball.placeOnSpot();
  keeper.reset();
  striker.reset();
  camera.position.copy(camBase());
  camLook.set(0, 1.4, G.mode === 'keeper' ? 8 : 0);
  el('vs-stage').textContent = G.mp ? '2-PLAYER SHOWDOWN' : STAGES[G.stageIdx].name;
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

let pickingFor = 1; // which player the team grid is currently choosing for

function pickTeam(team) {
  AudioFX.init();
  if (pickingFor === 1) {
    G.playerTeam = team;
    el('title-screen').classList.add('hidden');
    el('mode-screen').classList.remove('hidden');
  } else {
    G.oppTeam = team; // player 2
    startMpMatch();
  }
}

function startTournament(mode) {
  G.mode = mode;
  G.mp = null;
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

function pickMpMode(mp) {
  G.mp = mp;
  pickingFor = 2;
  el('mode-screen').classList.add('hidden');
  el('title-kicker').textContent = '🎮 Player 2';
  el('title-sub').textContent = "Pick Player 2's nation.";
  el('title-screen').classList.remove('hidden');
}

function startMpMatch() {
  pickingFor = 1;
  G.mode = 'striker'; // duels play out on the behind-the-spot camera
  G.stageIdx = 0;
  G.firstShotTaken = false;
  G.firstDiveTaken = false;
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
  el('mode-pass').addEventListener('pointerdown', () => pickMpMode('pass'));
  el('mode-split').addEventListener('pointerdown', () => pickMpMode('split'));
})();

// ---------------------------------------------------------------- resize & render loop
// per-mode camera home position; narrow portrait pulls back so the goal always fits
function camBase() {
  const squeeze = camera.aspect < 0.62 ? (0.62 - camera.aspect) : 0;
  return G.mode === 'keeper'
    ? new THREE.Vector3(0, 3.7, -3.6 - squeeze * 4) // above the crossbar, looking down the pitch
    : new THREE.Vector3(0, 2.3, SPOT_Z + 4.6 + squeeze * 6);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
onResize();

let lastT = performance.now() / 1000;
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
  const followX = Ball.flying ? Ball.pos.x * (keeperCam ? 0.12 : 0.18) : 0;
  camera.position.x = lerp(camera.position.x, followX + (Math.random() - 0.5) * camShake * 0.3, 0.12);
  camera.position.y = base.y + (Math.random() - 0.5) * camShake * 0.25;
  camera.position.z = lerp(camera.position.z, base.z + (keeperCam ? 0 : -camPush * 1.4), 0.09);
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
