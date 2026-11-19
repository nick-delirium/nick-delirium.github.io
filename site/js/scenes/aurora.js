// PROJECTS · Aurora. The wallpaper generator in ASCII: a glowing ribbon (a seeded wave of three
// sines and a little noise) over a grainy gradient, drifting like the app's live mode. Every few
// seconds it "shuffles" and morphs into a new shape. A liquid-glass panel floats over it and
// refracts what's underneath: content near its rim is pulled in from outside, the middle is
// slightly magnified, and the rim catches the light. Hover and the glass follows the cursor.
import { HUE, G, clamp, hash1, rng, smooth, slopeGlyph, RAMP_IDX, RAMP_LEN } from "../engine/util.js";

// colour stops across the ribbon (the app's default palette), by distance from its spine in ribbon
// widths, negative above it: [z, colour, opacity over the page]. Kept dim enough for a dark page.
const STOPS = [
  [-9, "#1a36b8", 0.36], [-5, "#2f62d6", 0.44], [-1.8, "#a9a6ee", 0.52], [-0.6, "#e2d2f6", 0.6],
  [0.25, "#f0c3d6", 0.62], [0.9, "#f2934d", 0.62], [2.0, "#e470bd", 0.6], [3.6, "#c75fc4", 0.52],
  [6, "#6c4bd2", 0.44], [10, "#1a36b8", 0.36],
];
// a fine ramp between the stops, as background-only colours (hue indices 5, 6, …)
const SUB = 6;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const FILL = [];
for (let i = 0; i < STOPS.length - 1; i++) {
  const a = hex(STOPS[i][1]), b = hex(STOPS[i + 1][1]);
  for (let k = 0; k < (i === STOPS.length - 2 ? SUB + 1 : SUB); k++) {
    const c = a.map((v, j) => Math.round(v + (b[j] - v) * (k / SUB)));
    FILL.push("#" + c.map((v) => v.toString(16).padStart(2, "0")).join(""));
  }
}
const SWATCH = [0, 2, 3, 5, 6, 7].map((i) => 5 + i * SUB); // stop colours, for the panel's swatches
const SHUFFLE = 9; // seconds between new shapes
const MORPH = 1.8;

let rnd = rng(7), shapeA, shapeB, shuffleAt = SHUFFLE, morphT = 1;
let glass = { x: 0, y: 0 }, D;

function newShape() {
  return {
    off: (rnd() - 0.5) * 0.25,
    rot: (rnd() - 0.5) * 0.9,
    w: 0.045 + rnd() * 0.025,
    waves: [0, 1, 2].map((k) => ({ a: (0.09 + rnd() * 0.08) / (k + 1), f: 2.2 + k * 2.1 + rnd() * 1.5, p: rnd() * 6.28, s: (rnd() - 0.5) * 0.5 })),
  };
}
const ease = (x) => x * x * (3 - 2 * x);
const mixShape = (a, b, k) => ({
  off: a.off + (b.off - a.off) * k,
  rot: a.rot + (b.rot - a.rot) * k,
  w: a.w + (b.w - a.w) * k,
  waves: a.waves.map((w, i) => {
    const v = b.waves[i];
    return { a: w.a + (v.a - w.a) * k, f: w.f + (v.f - w.f) * k, p: w.p + (v.p - w.p) * k, s: w.s + (v.s - w.s) * k };
  }),
});

/** the wallpaper at a physical point: fill hue (dithered between stops), fill opacity, glow 0..1 */
function shade(px, py, sh, t, dith) {
  const S = D.S;
  let u = (px - D.W / 2) / S, v = (py - D.H / 2) / S;
  const c = Math.cos(sh.rot), s = Math.sin(sh.rot);
  [u, v] = [u * c + v * s, -u * s + v * c];
  let y = sh.off, dy = 0;
  for (const w of sh.waves) {
    const ph = w.f * u + w.p + w.s * t;
    y += w.a * Math.sin(ph);
    dy += w.a * w.f * Math.cos(ph);
  }
  y += 0.03 * Math.sin(u * 1.3 + t * 0.11) * Math.sin(t * 0.07 + u * 0.4);
  // glow breathes, and hotspots travel along the ribbon
  const width = sh.w * (1 + 0.3 * Math.sin(u * 2.3 + t * 0.35)) * (1 + 0.08 * Math.sin(t * 0.6));
  const z = (v - y) / Math.sqrt(1 + dy * dy) / width;
  const hot = 1 + 0.35 * Math.exp(-(((u - 0.6 * Math.sin(t * 0.21)) / 0.18) ** 2));
  let i = 0;
  while (i < STOPS.length - 2 && z > STOPS[i + 1][0]) i++;
  const [z0, , o0] = STOPS[i], [z1, , o1] = STOPS[i + 1];
  const k = clamp((z - z0) / (z1 - z0));
  const glow = Math.exp(-(z * z) / 5) * hot;
  // ramp position, dithered between neighbouring ramp colours (the app's anti-banding dither)
  const pos = (i + k) * SUB;
  const idx = Math.min(FILL.length - 1, Math.floor(pos) + (dith < pos - Math.floor(pos) ? 1 : 0));
  // lighter toward the top left, like the app's lightness vignette
  const vig = 0.86 + 0.14 * clamp(1 - (px / D.W + py / D.H) * 0.5);
  return [5 + idx, clamp((o0 + (o1 - o0) * k) * vig * (1 + 0.15 * (hot - 1))), glow];
}

/** rounded-rect signed distance and outward normal, physical units */
function glassSd(px, py) {
  const { gw, gh, gr } = D;
  const dx = px - glass.x, dy = py - glass.y;
  const qx = Math.abs(dx) - gw / 2 + gr, qy = Math.abs(dy) - gh / 2 + gr;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  const out = Math.hypot(ox, oy);
  const sd = out + Math.min(Math.max(qx, qy), 0) - gr;
  let nx, ny;
  if (out > 0) {
    nx = (ox / out) * Math.sign(dx);
    ny = (oy / out) * Math.sign(dy);
  } else if (qx > qy) {
    nx = Math.sign(dx);
    ny = 0;
  } else {
    nx = 0;
    ny = Math.sign(dy);
  }
  return [sd, nx, ny];
}

export default {
  id: "aurora",
  title: "AURORA",
  caption: "a ribbon of light, a pane of glass. shuffle.",
  fillHues: FILL,

  init(f, S) {
    f.useBg = true;
    const W = S.cols, H = S.rows / S.ax;
    const gw = Math.min(W * 0.62, 70), gh = Math.min(H * 0.2, gw * 0.42, 30);
    D = { W, H, S: Math.min(W, H), gw, gh, gr: gh * 0.42 };
    if (!shapeA) {
      shapeA = newShape();
      shapeB = shapeA;
      glass = { x: W * 0.5, y: H * 0.68 };
    }
    glass.x = clamp(glass.x, gw / 2 + 2, W - gw / 2 - 2);
    glass.y = clamp(glass.y, gh / 2 + 2, H - gh / 2 - 2);
  },

  frame(f, t, dt, S, input) {
    const { cols, rows, ax } = S;
    const V = f.v, Hh = f.h, Gg = f.g, B = f.b, BH = f.bh;
    f.clear();

    // shuffle: morph into a new shape every few seconds
    if (t > shuffleAt) {
      shapeA = mixShape(shapeA, shapeB, ease(clamp(morphT)));
      shapeB = newShape();
      morphT = 0;
      shuffleAt = t + SHUFFLE;
    }
    morphT += dt / MORPH;
    const sh = morphT >= 1 ? shapeB : mixShape(shapeA, shapeB, ease(clamp(morphT)));

    // the glass drifts on its own, or eases toward the cursor
    const { W, H, gw, gh } = D;
    let tx = W * (0.5 + 0.12 * Math.sin(t * 0.23)), ty = H * (0.66 + 0.12 * Math.sin(t * 0.17 + 1));
    if (input.inside) {
      tx = input.x + 0.5;
      ty = (input.y + 0.5) / ax;
    }
    tx = clamp(tx, gw / 2 + 2, W - gw / 2 - 2);
    ty = clamp(ty, gh / 2 + 2, H - gh / 2 - 2);
    const k = 1 - Math.exp(-dt * (input.inside ? 6 : 1.5));
    glass.x += (tx - glass.x) * k;
    glass.y += (ty - glass.y) * k;

    const tick = Math.floor(t * 14); // film grain refresh
    const bez = Math.min(gw, gh) * 0.32; // refracting bezel width
    const L = [-0.62, -0.78]; // light from the top left
    for (let y = 0, i = 0; y < rows; y++) {
      const py = (y + 0.5) / ax;
      for (let x = 0; x < cols; x++, i++) {
        const px = x + 0.5;
        const n = hash1(i * 7 + tick * 977);
        const [sd, nx, ny] = glassSd(px, py);
        let sx = px, sy = py, inGlass = sd < 0;
        if (inGlass) {
          // refraction: the rim pulls in what lies just outside it, the middle magnifies a little
          const depth = -sd, r = clamp(1 - depth / bez);
          const m = 0.9;
          sx = glass.x + (px - glass.x) * m + nx * r * r * bez * 1.1;
          sy = glass.y + (py - glass.y) * m + ny * r * r * bez * 1.1;
        }
        const [hue, op, glow] = shade(sx, sy, sh, t, hash1(i * 13));
        let fill = op;
        if (inGlass) fill = Math.min(1, op * 1.18 + 0.08); // the pane gathers a little light
        else if (sd < 3 && px - glass.x > -gw * 0.4 && py > glass.y) fill *= 0.78 + 0.07 * clamp(sd, 0, 3); // soft shadow
        B[i] = fill;
        BH[i] = hue;

        // rim: a bright edge where it faces the light, a faint one opposite
        if (sd > -0.9 && sd < 0.35) {
          const spec = Math.max(0, nx * L[0] + ny * L[1]);
          const back = Math.max(0, -(nx * L[0] + ny * L[1]));
          V[i] = 0.35 + 0.6 * spec + 0.2 * back;
          Hh[i] = HUE.white;
          Gg[i] = slopeGlyph(-ny, nx * ax, ax);
          continue;
        }
        // film grain on top: brighter and denser along the ribbon's glow; the glass smooths it out
        const gv = (0.06 + 0.3 * Math.min(1, glow)) * (0.5 + 0.5 * n) * (inGlass ? 0.4 : 1);
        if (gv > 0.12 || n > 0.88) {
          V[i] = Math.max(gv, 0.1);
          Hh[i] = HUE.white;
          Gg[i] = RAMP_IDX[Math.min(RAMP_LEN - 1, 1 + Math.floor(gv * 9 + n * 2))];
        }
      }
    }

    // the panel's contents, like the app's: name, palette swatches, a shuffle button
    const gx0 = Math.round(glass.x - gw / 2 + D.gr * 0.7), gy0 = Math.round((glass.y - gh / 2) * ax);
    const rowsIn = Math.round(gh * ax);
    if (gw > 34 && rowsIn >= 8) {
      const clear = (cx, cy, len) => {
        for (let k = 0; k < len; k++) {
          const o = cy * cols + cx + k;
          if (o >= 0 && o < V.length) V[o] = 0;
        }
      };
      const ty0 = gy0 + Math.max(2, Math.round(rowsIn * 0.22));
      clear(gx0, ty0, 7);
      f.text(gx0, ty0, "Aurora", HUE.white, 1);
      // swatches: one per palette colour, the current one marked
      const sy0 = ty0 + 2;
      const cur = Math.floor(t / SHUFFLE) % SWATCH.length;
      for (let s = 0; s < SWATCH.length; s++) {
        const cx = gx0 + s * 3;
        for (const dx of [0, 1]) {
          const o = sy0 * cols + cx + dx;
          if (o < 0 || o >= B.length) continue;
          B[o] = 1;
          BH[o] = SWATCH[s];
          V[o] = 0;
        }
        if (s === cur) f.set(cx, sy0 + 1, 0.9, HUE.white, G("^"));
      }
      // the shuffle button flashes when the shape changes
      const flash = smooth(0.3, 0, t - (shuffleAt - SHUFFLE));
      const label = "[ shuffle ]";
      const bx0 = Math.round(glass.x + gw / 2 - D.gr * 0.7 - label.length), by0 = sy0;
      clear(bx0, by0, label.length);
      f.text(bx0, by0, label, flash > 0.05 ? HUE.main : HUE.white, 0.75 + 0.25 * flash);
    }
  },
};
