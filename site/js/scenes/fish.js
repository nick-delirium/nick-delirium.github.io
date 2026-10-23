// Koi pond seen from above, drawn behind the first page. Each fish is built from its own
// set of symbols (katakana, letters, symbols) set on shaded cell blocks: a rounded body,
// filled pectoral and pelvic fins that flap, and a forked tail that swings with the body wave.
// They follow curving paths, leave ripples, shy from the cursor and scatter from clicks.
// Set `flee` and they race off-screen; `onGone` fires once the pond is empty.
import { HUE, clamp, noise2, hash1, rng, G, TAU } from "../engine/util.js";

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const N = 22; // spine samples, head → tail
const STEP = 0.45; // trail sampling distance (cell widths)

const KINDS = [
  // kohaku koi in katakana: white with red patches
  { glyphs: Array.from("ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ"), hue: HUE.white, accent: HUE.hot, koi: true },
  // a fish spelled in letters
  { glyphs: Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabdefghijkmnpqrstuvwyz"), hue: HUE.alt, accent: HUE.white },
  // and one in assorted symbols
  { glyphs: Array.from("§¶†‡±√∂∑∆∫≠≈≡∞※¤#%&@$*+=<>{}[]?!"), hue: HUE.main, accent: HUE.white },
].map((k) => ({ ...k, ids: k.glyphs.map(G) }));

let fish = [], ripples = [], motes = [], R, W = 1, Hp = 1, ax = 0.6, gone = false, seenShock = 0;
const SX = new Float32Array(N), SY = new Float32Array(N), NX = new Float32Array(N), NY = new Float32Array(N);

/** body half-width along the spine (s: 0 snout → 1 tail root): rounded head, widest a third
 * of the way back, then a taper to a firm tail stalk */
function widthAt(s, w0) {
  if (s < 0.32) return w0 * Math.sqrt(Math.max(0, 1 - Math.pow((0.32 - s) / 0.345, 2)));
  return w0 * (1 - 0.68 * Math.pow((s - 0.32) / 0.68, 1.15));
}

/** a fin as a filled teardrop in its own frame: root (rx, ry), direction (dx, dy), length, width.
 * Returns 0 outside, else 1 at the root fading to 0 at the tip. */
const FE = { margin: 0, nx: 0, ny: 0, u: 0 }; // edge info of the last fin hit
function finAt(px, py, rx, ry, dx, dy, len, wid) {
  const qx = px - rx, qy = py - ry;
  const a = qx * dx + qy * dy;
  if (a < -0.4 || a > len) return 0;
  const u = Math.max(0, a) / len;
  // broad root, widest a third of the way out, tapering to a rounded point
  const hw = wid * (u < 0.33 ? 0.62 + 0.38 * (u / 0.33) : Math.pow(1 - (u - 0.33) / 0.67, 0.8)) + 0.45;
  const b = -qx * dy + qy * dx;
  if (Math.abs(b) > hw) return 0;
  const sb = b >= 0 ? 1 : -1;
  FE.margin = Math.min(hw - Math.abs(b), (len - a) * 0.6);
  FE.u = u;
  // outward normal: across the fin, or along it near the tip
  FE.nx = u > 0.85 ? dx : -dy * sb;
  FE.ny = u > 0.85 ? dy : dx * sb;
  return 1 - u * 0.75;
}

function spawn(i, fromEdge) {
  const k = KINDS[i % KINDS.length];
  // narrow portrait screens get relatively bigger fish (sized from the width)
  const L = clamp(Math.min(W, Hp) * (Hp > W * 1.2 ? 0.34 : 0.23 + R() * 0.04) - i * 2, 14, 60);
  let x, y, h;
  const wide = W > Hp * 1.2;
  if (fromEdge) {
    // just outside an edge, heading in (on wide screens never from the left, where the text is)
    const side = wide ? [1, 2, 3][(R() * 3) | 0] : (R() * 4) | 0;
    x = side === 0 ? -L * 0.3 : side === 1 ? W + L * 0.3 : W * (0.3 + R() * 0.6);
    y = side === 2 ? -L * 0.3 : side === 3 ? Hp + L * 0.3 : Hp * (0.2 + R() * 0.6);
    h = Math.atan2(Hp / 2 - y, W / 2 - x) + (R() - 0.5) * 0.8;
  } else {
    x = W * (wide ? 0.5 + R() * 0.38 : 0.15 + R() * 0.7);
    y = Hp * (0.2 + R() * 0.6);
    h = R() * TAU;
  }
  const trail = [];
  for (let d = Math.ceil(L / STEP) + 4; d >= 0; d--) trail.push([x - Math.cos(h) * d * STEP, y - Math.sin(h) * d * STEP]);
  const f = { k, L, w0: L * 0.15, x, y, h, v: L * (0.17 + R() * 0.06), burst: fromEdge ? 1.6 : 0, trail, phase: R() * TAU, seed: R() * 100, seedI: (R() * 1e6) | 0, redHead: R() < 0.7, ripT: R(), out: false, scare: 0, scareAng: 0, sx: new Float32Array(N), sy: new Float32Array(N) };
  spine(f); // others steer around this body from the first step
  return f;
}

/** distance from (px, py) to the nearest point of another fish's spine, and that point */
function nearestOnBody(o, px, py) {
  let best = Infinity, bx = 0, by = 0;
  for (let i = 0; i < N; i += 2) {
    const d = Math.hypot(px - o.sx[i], py - o.sy[i]);
    if (d < best) {
      best = d;
      bx = o.sx[i];
      by = o.sy[i];
    }
  }
  return [best, bx, by];
}

function step(f, t, dt, input, flee) {
  const cx = W / 2, cy = Hp / 2;
  const ch = Math.cos(f.h), sh = Math.sin(f.h);
  // every behaviour adds a wish to turn; the total is capped by what a koi's body allows
  let turn = 0;
  const toward = (ang, gain) => (turn += clamp(wrap(ang - f.h), -1, 1) * gain);

  if (flee) {
    // race for the nearest exit, fast enough to clear any screen in about a second
    toward(Math.atan2(f.y - cy, f.x - cx), 4);
    f.flee = Math.min(1, (f.flee || 0) + dt * 1.6);
  } else {
    f.flee = 0;
    // avoiding each other comes first: look along the path for anyone's body, not just their centre
    let avoid = 0, brake = 1;
    for (const o of fish) {
      if (o === f || o.out) continue;
      const clear = (f.w0 + o.w0) * 1.6 + 2;
      for (const ahead of [0, f.L * 0.5, f.L * 1.0]) {
        const [d, bx, by] = nearestOnBody(o, f.x + ch * ahead, f.y + sh * ahead);
        const zone = clear * (ahead ? 1.4 : 1.8);
        if (d < zone) {
          const k = 1 - d / zone;
          avoid += clamp(wrap(Math.atan2(f.y + sh * ahead - by, f.x + ch * ahead - bx) - f.h), -1, 1) * 4.5 * k * k;
          if (ahead) brake = Math.min(brake, 0.45 + 0.55 * (1 - k));
        }
      }
    }
    f.brake = brake;
    if (Math.abs(avoid) > 0.05) {
      turn += avoid;
    } else {
      // wander: slow drift with a wide dead zone, so most of the time is spent swimming straight
      const nz = noise2(f.seed, t * 0.09);
      turn += Math.abs(nz) < 0.5 ? 0 : (nz - Math.sign(nz) * 0.5) * 2;
      // look ahead and turn early instead of jerking away at the edge
      const wide = W > Hp * 1.2;
      const m = f.L * 0.45;
      // keep right of the text only where there's room for it
      const x0 = W > Hp * 1.6 ? W * 0.37 : wide ? W * 0.22 : m, x1 = W - m, y0 = m, y1 = Hp - m;
      const look = f.L * 1.2;
      const lx = f.x + ch * look, ly = f.y + sh * look;
      if (lx < x0 || lx > x1 || ly < y0 || ly > y1) toward(Math.atan2((y0 + y1) / 2 - f.y, (x0 + x1) / 2 - f.x), 1.4);
    }
    // shy of the cursor
    if (input.inside) {
      const dx = f.x - input.x, dy = f.y - input.y / ax, dd = Math.hypot(dx, dy);
      if (dd < f.L * 0.8) {
        toward(Math.atan2(dy, dx), 3);
        f.burst = Math.max(f.burst, 0.8);
      }
    }
    // scattered by a click: curve away hard for a moment
    if (f.scare > 0) {
      f.scare -= dt;
      toward(f.scareAng, 5);
    }
  }
  f.burst *= Math.exp(-dt * 1.5);
  const cruise = f.v * (1 + f.burst * 2.2) * (0.85 + 0.3 * (noise2(f.seed + 9, t * 0.4) * 0.5 + 0.5));
  const v = cruise * (f.brake ?? 1) + (Math.max(W, Hp) * 0.75 - cruise) * (f.flee || 0) * (f.flee || 0);
  // a koi can't turn tighter than about 0.4 body lengths (faster when darting)
  const maxTurn = Math.max(0.45, v / (f.L * 0.4));
  f.h += clamp(turn, -maxTurn, maxTurn) * dt;
  f.x += Math.cos(f.h) * v * dt;
  f.y += Math.sin(f.h) * v * dt;
  f.phase += dt * (3 + v * 0.35);
  const last = f.trail[f.trail.length - 1];
  if (Math.hypot(f.x - last[0], f.y - last[1]) >= STEP) {
    f.trail.push([f.x, f.y]);
    if (f.trail.length > Math.ceil(f.L / STEP) + 8) f.trail.shift();
  }
  // never through each other: if any part of this body touches another, push this fish out
  if (!flee) {
    for (const o of fish) {
      if (o === f || o.out) continue;
      const touch = (f.w0 + o.w0) * 0.85;
      let px = 0, py = 0, depth = 0;
      for (let p = 0; p < N; p += 3) {
        const [d, bx, by] = nearestOnBody(o, f.sx[p], f.sy[p]);
        if (d < touch && touch - d > depth) {
          depth = touch - d;
          px = (f.sx[p] - bx) / (d || 1);
          py = (f.sy[p] - by) / (d || 1);
        }
      }
      if (depth > 0) {
        f.x += px * Math.min(depth, 1) * 0.7;
        f.y += py * Math.min(depth, 1) * 0.7;
      }
    }
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
  // bones: rebuild from the head with limited bend per segment. The front two thirds can only
  // bend a few degrees in total; nearly all the flex is in the tail.
  const seg = f.L / (N - 1);
  let prev = f.h + Math.PI;
  for (let i = 0; i < N - 1; i++) {
    const sNorm = i / (N - 1);
    const maxBend = sNorm < 0.62 ? 0.022 : 0.085;
    const raw = Math.atan2(SY[i + 1] - SY[i], SX[i + 1] - SX[i]);
    const a = prev + clamp(wrap(raw - prev), -maxBend, maxBend);
    SX[i + 1] = SX[i] + Math.cos(a) * seg;
    SY[i + 1] = SY[i] + Math.sin(a) * seg;
    prev = a;
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
    const o = f.L * 0.08 * Math.pow(s, 2.6) * Math.sin(f.phase - s * 5);
    SX[i] += NX[i] * o;
    SY[i] += NY[i] * o;
  }
  f.sx.set(SX);
  f.sy.set(SY);
}

// fin anchors along the body (fraction of the spine) and how far back they sweep
const PEC = 0.26, PEL = 0.6;
const FINS = new Float32Array(6 * 6); // per fin: rx, ry, dx, dy, len, wid
const WS = new Float32Array(N); // body half-width at each spine sample

function drawFish(fl, f, t) {
  const { cols, rows } = fl;
  const k = f.k, ids = k.ids, nG = ids.length;
  const V = fl.v, Hh = fl.h, Gg = fl.g, B = fl.b, BH = fl.bh;
  const w0 = f.w0, L = f.L;
  const fold = 1 - 0.5 * Math.max(clamp(f.burst / 1.5), f.flee || 0); // fins tuck in at speed

  // place the six fins: two pectoral, two pelvic, two tail lobes
  let nf = 0;
  const put = (rx, ry, ang, len, wid) => {
    FINS[nf * 6] = rx;
    FINS[nf * 6 + 1] = ry;
    FINS[nf * 6 + 2] = Math.cos(ang);
    FINS[nf * 6 + 3] = Math.sin(ang);
    FINS[nf * 6 + 4] = len;
    FINS[nf * 6 + 5] = wid;
    nf++;
  };
  const at = (s) => Math.min(N - 2, Math.round(s * (N - 1)));
  for (const sd of [1, -1]) {
    const flap = Math.sin(f.phase * 0.9 + (sd > 0 ? 0 : 1.9));
    let i = at(PEC);
    let w = widthAt(PEC, w0) * 0.62;
    let back = Math.atan2(SY[i + 1] - SY[i], SX[i + 1] - SX[i]); // toward the tail
    let out = Math.atan2(NY[i] * sd, NX[i] * sd);
    const ang = blend(out, back, 0.42 + 0.3 * (1 - fold) + 0.12 * flap);
    put(SX[i] + NX[i] * w * sd, SY[i] + NY[i] * w * sd, ang, w0 * 2.1 * fold * (0.85 + 0.15 * flap), w0 * 0.62);
    i = at(PEL);
    w = widthAt(PEL, w0) * 0.62;
    back = Math.atan2(SY[i + 1] - SY[i], SX[i + 1] - SX[i]);
    out = Math.atan2(NY[i] * sd, NX[i] * sd);
    put(SX[i] + NX[i] * w * sd, SY[i] + NY[i] * w * sd, blend(out, back, 0.6), w0 * 1.15 * fold, w0 * 0.36);
  }
  const tail = Math.atan2(SY[N - 1] - SY[N - 4], SX[N - 1] - SX[N - 4]) + Math.sin(f.phase - 6.2) * 0.3;
  for (const sd of [1, -1]) {
    const ang = tail + sd * 0.44;
    const lx = SX[N - 1] - Math.cos(tail) * w0 * 0.4, ly = SY[N - 1] - Math.sin(tail) * w0 * 0.4;
    put(lx, ly, ang, L * 0.34, w0 * 0.62);
  }

  for (let i = 0; i < N; i++) WS[i] = widthAt(i / (N - 1), w0);
  // bounds: body plus everything the fins can reach
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < N; i++) {
    x0 = Math.min(x0, SX[i]);
    x1 = Math.max(x1, SX[i]);
    y0 = Math.min(y0, SY[i]);
    y1 = Math.max(y1, SY[i]);
  }
  const reach = L * 0.36 + 2;
  const cx0 = Math.max(0, Math.floor(x0 - reach)), cx1 = Math.min(cols - 1, Math.ceil(x1 + reach));
  const cy0 = Math.max(0, Math.floor((y0 - reach) * ax)), cy1 = Math.min(rows - 1, Math.ceil((y1 + reach) * ax));
  const tick = Math.floor(t * 2.2);

  for (let cy = cy0; cy <= cy1; cy++) {
    const py = (cy + 0.5) / ax;
    for (let cx = cx0; cx <= cx1; cx++) {
      const px = cx + 0.5;
      // body coordinates from the segment whose surface is closest (distance minus local width), so
      // a bent body never maps a cell onto the thin tail stalk and leaves a hole
      let best = Infinity, bs = 0, side = 1, d = 0, w = 0, nqx = 0, nqy = 0;
      for (let i = 0; i < N - 1; i++) {
        const sx = SX[i], sy = SY[i], ex = SX[i + 1] - sx, ey = SY[i + 1] - sy;
        const u = clamp(((px - sx) * ex + (py - sy) * ey) / (ex * ex + ey * ey || 1));
        const qx = px - sx - ex * u, qy = py - sy - ey * u;
        const dd = Math.sqrt(qx * qx + qy * qy);
        const ww = WS[i] + (WS[i + 1] - WS[i]) * u;
        if (dd - ww < best) {
          best = dd - ww;
          bs = (i + u) / (N - 1);
          side = qx * NX[i] + qy * NY[i] >= 0 ? 1 : -1;
          d = dd;
          w = ww;
          nqx = qx;
          nqy = qy;
        }
      }
      let v = 0, bg = 0, part = 0, edge = -1, enx = 0, eny = 0, thin = false;
      if (d <= w + 0.15) {
        if (w + 0.15 - d < 0.8) {
          // a contour stroke, unless a fin carries on past this edge (that would read as a seam)
          let covered = false;
          for (let q = 0; q < nf && !covered; q++) {
            const o = q * 6;
            covered = finAt(px + nqx * 1.2 / (d || 1), py + nqy * 1.2 / (d || 1), FINS[o], FINS[o + 1], FINS[o + 2], FINS[o + 3], FINS[o + 4], FINS[o + 5]) > 0;
          }
          if (!covered) {
            edge = 1;
            enx = nqx;
            eny = nqy;
            thin = w < 1;
          }
        }
        const lat = Math.min(1, d / (w || 1));
        const z = Math.sqrt(Math.max(0, 1 - lat * lat));
        v = 0.32 + 0.5 * z;
        bg = 0.3 + 0.62 * z;
        if (bs > 0.2 && bs < 0.68 && lat < 0.26) v = Math.min(1, v + 0.18); // dorsal ridge
        part = 1;
      } else {
        let fp = 0;
        for (let q = 0; q < nf && !fp; q++) {
          const o = q * 6;
          fp = finAt(px, py, FINS[o], FINS[o + 1], FINS[o + 2], FINS[o + 3], FINS[o + 4], FINS[o + 5]);
        }
        if (!fp) continue;
        v = 0.2 + 0.32 * fp;
        bg = 0.14 + 0.42 * fp;
        part = 2;
        if (FE.margin < 0.8) {
          edge = 1;
          enx = FE.nx;
          eny = FE.ny;
          thin = FE.u > 0.82;
        }
      }

      // colour: kohaku patches on the koi (white glyphs on red blocks), a pale spine on the others
      const lu = bs * L, lv = side * d;
      let hue = k.hue, bh = k.hue;
      if (k.koi) {
        if (part === 1 && (noise2(lu * 0.15 + f.seed, lv * 0.3 + f.seed * 0.7) > 0.08 || (bs < 0.13 && f.redHead))) bh = k.accent;
      } else if (part === 1 && d / (w || 1) < 0.3 && bs > 0.12 && bs < 0.8) {
        hue = k.accent;
      }

      // glyphs stick to the body (they swim along with it); a few shimmer
      const gi = Math.floor(lu * 1.05) * 73 + Math.floor(lv * 1.6) * 31 + f.seedI;
      const flick = hash1(gi * 7 + 3) < 0.06 ? tick : 0;
      let idx = ids[(hash1(gi + flick * 977) * nG) | 0];
      if (edge > 0) {
        // the silhouette is drawn in thin strokes that follow the contour
        idx = thin ? (eny > 0 ? G_TICK : G_DOT) : edgeGlyph(enx, eny);
        v = v * 0.8 + 0.08;
        bg *= 0.35;
      }
      const o = cy * cols + cx;
      if (v > V[o]) {
        V[o] = v;
        Hh[o] = hue;
        Gg[o] = idx;
      }
      if (bg > B[o]) {
        B[o] = bg;
        BH[o] = bh;
      }
    }
  }
  // eyes on either side of the head, in dark sockets
  for (const sd of [1, -1]) {
    const ex = Math.round(SX[2] + NX[2] * w0 * 0.5 * sd - 0.5), ey = Math.round((SY[2] + NY[2] * w0 * 0.5 * sd) * ax - 0.5);
    if (ex < 0 || ey < 0 || ex >= cols || ey >= rows) continue;
    fl.set(ex, ey, 1, HUE.white, G("●"));
    B[ey * cols + ex] = 0;
  }
}

const G_DOT = G("."), G_TICK = G("'");
const EDGE = [G(")"), G("/"), G("'"), G("\\"), G("("), G("/"), G("_"), G("\\")];
/** a thin glyph for a contour whose outward normal is (nx, ny), y pointing down */
function edgeGlyph(nx, ny) {
  const a = Math.atan2(ny, nx); // 0 = right, π/2 = down
  return EDGE[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

function blend(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

export default {
  id: "fish",
  title: "KOI_POND",
  caption: "three fish and a little wake",
  flee: false,
  onGone: null,
  get school() {
    return fish; // for tests and tooling
  },

  init(f, S) {
    f.useBg = true;
    const first = !R;
    if (first) R = rng(7);
    const oldW = W, oldH = Hp;
    ax = S.ax;
    W = S.cols;
    Hp = S.rows / ax;
    if (first || !fish.length) {
      const n = 3;
      fish = Array.from({ length: n }, (_, i) => spawn(i, false));
      // swim a little so the bodies start curved
      for (let s = 0; s < 120; s++) {
        for (const fi of fish) step(fi, s / 30, 1 / 30, { inside: false }, false);
        for (const fi of fish) spine(fi);
      }
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
          fi.scareAng = Math.atan2(dy, dx);
          fi.scare = 0.9;
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
