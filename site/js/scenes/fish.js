// Koi pond seen from above, drawn behind the first page. Each fish is built from its own
// set of symbols, follows a curving path with an undulating body, flaps its fins, leaves
// small ripples, shies away from the cursor and scatters from clicks. Set `flee` and they
// race off-screen; `onGone` fires once the pond is empty. Clear `flee` and they swim back.
import { HUE, clamp, noise2, hash1, rng, G, TAU } from "../engine/util.js";

const N = 22; // spine samples, head → tail
const STEP = 0.45; // trail sampling distance (cell widths)

const KINDS = [
  { glyphs: Array.from("@%&8#"), hue: HUE.white, accent: HUE.hot, fin: G("~") }, // koi
  { glyphs: Array.from("{}[]()<>;="), hue: HUE.alt, accent: HUE.alt, fin: G("/") }, // code
  { glyphs: Array.from("01"), hue: HUE.main, accent: HUE.main, fin: G("1") }, // binary
].map((k) => ({ ...k, ids: k.glyphs.map(G) }));

let fish = [], ripples = [], motes = [], R, W = 1, Hp = 1, ax = 0.6, gone = false, seenShock = 0;
const SX = new Float32Array(N), SY = new Float32Array(N), NX = new Float32Array(N), NY = new Float32Array(N);

function widthAt(s, w0) {
  if (s < 0.2) return w0 * Math.pow(Math.sin((Math.PI / 2) * (s / 0.2)), 0.6);
  return w0 * (1 - Math.pow((s - 0.2) / 0.8, 1.5) * 0.86);
}

function spawn(i, fromEdge) {
  const k = KINDS[i % KINDS.length];
  const L = clamp(Math.min(W, Hp) * (0.2 + R() * 0.07), 13, 56);
  let x, y, h;
  if (fromEdge) {
    // just outside a random edge, heading in
    const side = (R() * 4) | 0;
    x = side === 0 ? -L * 0.3 : side === 1 ? W + L * 0.3 : W * (0.3 + R() * 0.6);
    y = side === 2 ? -L * 0.3 : side === 3 ? Hp + L * 0.3 : Hp * (0.2 + R() * 0.6);
    h = Math.atan2(Hp / 2 - y, W / 2 - x) + (R() - 0.5) * 0.8;
  } else {
    x = W * (0.15 + R() * 0.7);
    y = Hp * (0.15 + R() * 0.7);
    h = R() * TAU;
  }
  const trail = [];
  for (let d = Math.ceil(L / STEP) + 4; d >= 0; d--) trail.push([x - Math.cos(h) * d * STEP, y - Math.sin(h) * d * STEP]);
  return { k, L, w0: L * 0.17, x, y, h, v: L * (0.17 + R() * 0.06), burst: fromEdge ? 1.6 : 0, trail, phase: R() * TAU, seed: R() * 100, ripT: R(), out: false };
}

function steer(f, target, rate, dt) {
  let d = target - f.h;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  f.h += clamp(d, -rate * dt, rate * dt);
}

function step(f, t, dt, input, flee) {
  const cx = W / 2, cy = Hp / 2;
  if (flee) {
    // race for the nearest exit, fast enough to clear any screen in about a second
    steer(f, Math.atan2(f.y - cy, f.x - cx), 3.2, dt);
    f.flee = Math.min(1, (f.flee || 0) + dt * 1.6);
  } else {
    f.flee = 0;
    f.h += noise2(f.seed, t * 0.22) * 1.3 * dt;
    // on wide screens the text sits on the left: prefer the open water on the right
    if (W > Hp * 1.2) {
      const hx = W * 0.7, hy = Hp * 0.5;
      if (Math.hypot(f.x - hx, (f.y - hy) * 1.4) > Math.min(W * 0.26, Hp * 0.5)) steer(f, Math.atan2(hy - f.y, hx - f.x), 0.9, dt);
    }
    // keep inside the pond
    const m = f.L * 0.9;
    if (f.x < m || f.x > W - m || f.y < m || f.y > Hp - m) steer(f, Math.atan2(cy - f.y, cx - f.x), 1.6, dt);
    // personal space
    for (const o of fish) {
      if (o === f) continue;
      const dx = f.x - o.x, dy = f.y - o.y, dd = Math.hypot(dx, dy);
      if (dd < f.L * 0.9) steer(f, Math.atan2(dy, dx), 1.2, dt);
    }
    // shy of the cursor
    if (input.inside) {
      const dx = f.x - input.x, dy = f.y - input.y / ax, dd = Math.hypot(dx, dy);
      if (dd < f.L * 0.8) {
        steer(f, Math.atan2(dy, dx), 4, dt);
        f.burst = Math.max(f.burst, 0.8);
      }
    }
  }
  f.burst *= Math.exp(-dt * 1.5);
  const cruise = f.v * (1 + f.burst * 2.2) * (0.85 + 0.3 * (noise2(f.seed + 9, t * 0.4) * 0.5 + 0.5));
  const v = cruise + (Math.max(W, Hp) * 0.75 - cruise) * (f.flee || 0) * (f.flee || 0);
  f.x += Math.cos(f.h) * v * dt;
  f.y += Math.sin(f.h) * v * dt;
  f.phase += dt * (3 + v * 0.35);
  const last = f.trail[f.trail.length - 1];
  if (Math.hypot(f.x - last[0], f.y - last[1]) >= STEP) {
    f.trail.push([f.x, f.y]);
    if (f.trail.length > Math.ceil(f.L / STEP) + 8) f.trail.shift();
  }
  f.ripT -= dt * (0.9 + f.burst);
  if (f.ripT <= 0 && !f.out) {
    f.ripT = 0.7 + R() * 0.6;
    ripples.push({ x: f.x - Math.cos(f.h) * f.L * 0.15, y: f.y - Math.sin(f.h) * f.L * 0.15, age: 0, life: 1.8, max: f.w0 * 1.8 + 2 });
  }
  const margin = f.L * 1.3;
  f.out = f.x < -margin || f.x > W + margin || f.y < -margin || f.y > Hp + margin;
}

/** walk the trail back from the head to place the spine, then add the swimming wave */
function spine(f) {
  const tr = f.trail;
  let j = tr.length - 1, px = f.x, py = f.y, acc = 0;
  SX[0] = px;
  SY[0] = py;
  for (let i = 1; i < N; i++) {
    const want = (i / (N - 1)) * f.L;
    while (j > 0) {
      const qx = tr[j - 1][0], qy = tr[j - 1][1];
      const seg = Math.hypot(qx - px, qy - py);
      if (acc + seg >= want) {
        const u = (want - acc) / (seg || 1);
        px += (qx - px) * u;
        py += (qy - py) * u;
        acc = want;
        break;
      }
      acc += seg;
      px = qx;
      py = qy;
      j--;
    }
    SX[i] = px;
    SY[i] = py;
  }
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
    let tx = SX[a] - SX[b], ty = SY[a] - SY[b];
    const l = Math.hypot(tx, ty) || 1;
    NX[i] = -ty / l;
    NY[i] = tx / l;
  }
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const o = f.L * 0.075 * Math.pow(s, 1.4) * Math.sin(f.phase - s * 5.5);
    SX[i] += NX[i] * o;
    SY[i] += NY[i] * o;
  }
}

function drawFish(fl, f, t) {
  const { cols, rows } = fl;
  const k = f.k, ids = k.ids;
  const pad = f.w0 + 1;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < N; i++) {
    x0 = Math.min(x0, SX[i]);
    x1 = Math.max(x1, SX[i]);
    y0 = Math.min(y0, SY[i]);
    y1 = Math.max(y1, SY[i]);
  }
  const cx0 = Math.max(0, Math.floor(x0 - pad)), cx1 = Math.min(cols - 1, Math.ceil(x1 + pad));
  const cy0 = Math.max(0, Math.floor((y0 - pad) * ax)), cy1 = Math.min(rows - 1, Math.ceil((y1 + pad) * ax));
  const tick = Math.floor(t * 5);
  for (let cy = cy0; cy <= cy1; cy++) {
    const py = cy / ax;
    for (let cx = cx0; cx <= cx1; cx++) {
      // nearest spine segment
      let best = Infinity, bs = 0, bside = 0;
      for (let i = 0; i < N - 1; i++) {
        const ax_ = SX[i], ay = SY[i], bx = SX[i + 1], by = SY[i + 1];
        const ex = bx - ax_, ey = by - ay;
        const u = clamp(((cx - ax_) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1));
        const qx = ax_ + ex * u - cx, qy = ay + ey * u - py;
        const d2 = qx * qx + qy * qy;
        if (d2 < best) {
          best = d2;
          bs = (i + u) / (N - 1);
          bside = qx * NX[i] + qy * NY[i];
        }
      }
      const d = Math.sqrt(best);
      const w = widthAt(bs, f.w0);
      if (d > w) continue;
      const lat = d / (w || 1);
      let v = 0.3 + 0.32 * (1 - lat * lat);
      if (lat > 0.8) v *= 0.7;
      let g, hue = k.hue;
      const u = bs * f.L * 0.9, q = (bside < 0 ? -lat : lat) * f.w0 * 0.9;
      if (k === KINDS[0]) {
        g = ids[Math.min(ids.length - 1, ((1 - lat) * ids.length) | 0)];
        if (noise2(bs * 3.2 + f.seed, q * 0.35 + f.seed) > 0.12) hue = k.accent; // koi patches
      } else if (k === KINDS[1]) {
        g = ids[((((Math.floor(u + q) + Math.floor(u - q)) % ids.length) + ids.length) % ids.length)];
      } else {
        g = ids[hash1(Math.floor(u * 1.4) * 131 + Math.floor(q * 2) * 7 + tick * 977) < 0.5 ? 0 : 1];
      }
      fl.plot(cx, cy, v, hue, g);
    }
  }
  // eyes, either side of the head
  for (const sd of [1, -1]) {
    const ex = SX[1] + NX[1] * f.w0 * 0.55 * sd, ey = SY[1] + NY[1] * f.w0 * 0.55 * sd;
    fl.set(ex, ey * ax, 0.85, HUE.white, G("●"));
  }
  // pectoral fins, flapping
  const flap = Math.sin(f.phase * 1.3) * 0.45;
  for (const sd of [1, -1]) {
    const i = 5, w = widthAt(i / (N - 1), f.w0);
    const bx = SX[i] + NX[i] * w * sd, by = SY[i] + NY[i] * w * sd;
    const back = Math.atan2(SY[i + 2] - SY[i], SX[i + 2] - SX[i]);
    const a = Math.atan2(NY[i] * sd, NX[i] * sd) * 0.5 + back * 0.5 + flap * sd;
    const len = f.w0 * 1.5;
    fl.line(bx, by * ax, bx + Math.cos(a) * len, (by + Math.sin(a) * len) * ax, 0.32, k.accent, "auto", ax);
  }
  // forked tail, swinging with the body wave
  const tx = SX[N - 1], ty = SY[N - 1];
  const dir = Math.atan2(SY[N - 1] - SY[N - 3], SX[N - 1] - SX[N - 3]);
  for (const sd of [1, -1]) {
    const a = dir + sd * 0.55 + Math.sin(f.phase - 5.5) * 0.25;
    const len = f.w0 * 1.9;
    const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len;
    fl.line(tx, ty * ax, ex, ey * ax, 0.42, k.accent, "auto", ax);
    fl.line((tx + ex) / 2, ((ty + ey) / 2) * ax, ex, ey * ax, 0.3, k.hue, k.fin, ax);
  }
}

export default {
  id: "fish",
  title: "KOI_POND",
  caption: "three fish and a little wake",
  flee: false,
  onGone: null,

  init(f, S) {
    const first = !R;
    if (first) R = rng(7);
    const oldW = W, oldH = Hp;
    ax = S.ax;
    W = S.cols;
    Hp = S.rows / ax;
    if (first || !fish.length) {
      const n = W * Hp > 9000 ? 3 : 2;
      fish = Array.from({ length: n }, (_, i) => spawn(i, false));
      // swim a little so the bodies start curved
      for (let s = 0; s < 120; s++) for (const fi of fish) step(fi, s / 30, 1 / 30, { inside: false }, false);
      ripples = [];
    } else {
      // keep swimming through resizes (mobile toolbars resize the viewport constantly)
      const sx = W / oldW, sy = Hp / oldH;
      for (const fi of fish) {
        fi.x *= sx;
        fi.y *= sy;
        for (const p of fi.trail) {
          p[0] *= sx;
          p[1] *= sy;
        }
      }
    }
    motes = Array.from({ length: Math.round((W * Hp) / 260) }, () => [R() * W, R() * Hp, R()]);
  },

  frame(f, t, dt, S, input) {
    f.clear();
    // a fish leaving or arriving: hand the pond back to the page when empty, refill when asked
    if (!this.flee && gone) {
      gone = false;
      fish = fish.map((_, i) => spawn(i, true));
    }
    // clicks scatter nearby fish
    for (const s of input.shocks) {
      if (s.t <= seenShock) continue;
      seenShock = s.t;
      ripples.push({ x: s.x, y: s.y / ax, age: 0, life: 2.2, max: 9 });
      for (const fi of fish) {
        const dx = fi.x - s.x, dy = fi.y - s.y / ax;
        if (Math.hypot(dx, dy) < fi.L * 1.6) {
          fi.h = Math.atan2(dy, dx);
          fi.burst = 1.6;
        }
      }
    }
    for (const fi of fish) step(fi, t, dt, input, this.flee);

    // water motes drifting
    for (const m of motes) {
      m[0] += Math.sin(t * 0.2 + m[2] * 9) * 0.6 * dt;
      m[1] += 0.25 * dt;
      if (m[1] > Hp) m[1] = 0;
      f.plot(m[0], m[1] * ax, 0.07 + m[2] * 0.06, HUE.alt);
    }
    // ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.age += dt;
      if (r.age > r.life) {
        ripples.splice(i, 1);
        continue;
      }
      const p = r.age / r.life;
      const rad = 0.6 + r.max * Math.sqrt(p);
      const v = 0.3 * (1 - p);
      const n = Math.max(8, Math.ceil(rad * 7));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        f.plot(r.x + Math.cos(a) * rad, (r.y + Math.sin(a) * rad) * ax, v, HUE.alt);
      }
    }
    for (const fi of fish) {
      if (fi.out) continue;
      spine(fi);
      drawFish(f, fi, t);
    }
    if (this.flee && !gone && fish.every((fi) => fi.out)) {
      gone = true;
      this.onGone?.();
    }
  },
};
