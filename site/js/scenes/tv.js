// The last page: an old CRT television on a dark floor, tuned to a dead channel.
// The cabinet is drawn on shaded cell blocks; the screen shows live static with rolling
// sync bars, tearing and a curved-glass vignette. Every so often the set flips channels:
// a test card, a "no signal" slate, or a faint broadcast that never quite resolves.
import { HUE, clamp, smooth, hash1, noise2, rng, G } from "../engine/util.js";

const STATIC = Array.from(" .·:;'`-=+*x%#░▒▓").map(G);
const BARS = [HUE.white, HUE.main, HUE.alt, HUE.main, HUE.hot, HUE.alt, HUE.fg];
const CHANNELS = ["03", "07", "11", "13", "21", "42", "88", "99"];

let R, tv, flip, next, ch, mode, glitchT;

function layout(S) {
  const { cols, rows, ax } = S;
  const Hp = rows / ax;
  // cabinet: 4:3 screen plus a side panel for the knobs, fitted to the viewport
  let sw = Math.min(cols * 0.62, Hp * 0.62 * (4 / 3));
  const sh = sw * 0.75;
  const panel = sw * 0.3;
  const pad = sw * 0.08;
  const bw = sw + panel + pad * 2.4, bh = sh + pad * 2;
  const bx = (cols - bw) / 2, by = (Hp - bh) / 2 + Hp * 0.04;
  tv = {
    bx, by, bw, bh,
    sx: bx + pad, sy: by + pad, sw, sh,
    px: bx + pad * 1.6 + sw, pw: panel,
    r: pad * 1.4, // cabinet corner radius
  };
}

/** signed distance to a rounded rectangle (physical units) */
function rrect(px, py, x, y, w, h, r) {
  const cx = x + w / 2, cy = y + h / 2;
  const qx = Math.abs(px - cx) - w / 2 + r, qy = Math.abs(py - cy) - h / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

export default {
  id: "tv",
  title: "DEAD_CHANNEL",
  caption: "nothing on. it never stops.",

  init(f, S) {
    f.useBg = true;
    if (!R) R = rng(1984);
    layout(S);
    flip = 0;
    next = 6 + R() * 5;
    ch = CHANNELS[0];
    mode = "static";
    glitchT = 0;
  },

  frame(f, t, dt, S) {
    const { cols, rows, ax } = S;
    const V = f.v, H = f.h, Gg = f.g, B = f.b, BH = f.bh;
    f.clear();

    // channel flips: a burst of snow, then something else for a moment, then back to static
    if (t > next) {
      ch = CHANNELS[(R() * CHANNELS.length) | 0];
      const roll = R();
      mode = roll < 0.35 ? "bars" : roll < 0.6 ? "nosignal" : roll < 0.8 ? "ghost" : "static";
      flip = 1;
      next = t + (mode === "static" ? 5 : 2.6) + R() * 4;
    }
    if (mode !== "static" && next - t < 0.4) mode = "static";
    flip = Math.max(0, flip - dt * 2.2);
    glitchT -= dt;
    if (glitchT < -2 && R() < dt * 0.4) glitchT = 0.18;

    const { sx, sy, sw, sh, bx, by, bw, bh, px, pw } = tv;
    const tick = Math.floor(t * 24);
    const roll = (t * 0.18) % 1.3 - 0.15; // a slow bright sync bar travelling down
    const tear = glitchT > 0 ? (R() - 0.5) * 6 : 0;

    for (let y = 0, i = 0; y < rows; y++) {
      const py = (y + 0.5) / ax;
      for (let x = 0; x < cols; x++, i++) {
        const pxx = x + 0.5;
        // floor glow: light spilling from the screen onto the surroundings
        const gx = (pxx - (sx + sw / 2)) / sw, gy = (py - (sy + sh / 2)) / sh;
        const spill = Math.exp(-(gx * gx * 1.6 + gy * gy * 2.2)) * 0.14;
        if (spill > 0.03 && hash1(i * 31 + tick) < spill * 2.2) {
          V[i] = spill;
          H[i] = HUE.alt;
          Gg[i] = G("·");
        }

        const dCab = rrect(pxx, py, bx, by, bw, bh, tv.r);
        if (dCab > 0) continue;

        // inside the cabinet
        const dScr = rrect(pxx, py, sx, sy, sw, sh, sh * 0.12);
        if (dScr < 0) {
          // ── the screen ──
          const u = (pxx - sx) / sw, v = (py - sy) / sh;
          const cu = u - 0.5, cv = v - 0.5;
          const vign = clamp(1 - (cu * cu + cv * cv) * 1.5); // curved glass falls off at the corners
          const rowJit = glitchT > 0 && hash1(y * 7 + tick) < 0.3 ? tear : 0;
          const uu = u + rowJit / sw;
          let val, hue = HUE.fg, g;
          const bar = Math.exp(-Math.pow((v - roll) / 0.06, 2));

          if (mode === "bars" && flip < 0.6) {
            // SMPTE-ish test card
            const k = Math.min(BARS.length - 1, Math.floor(uu * BARS.length));
            hue = BARS[k];
            val = v < 0.7 ? 0.55 : v < 0.78 ? 0.3 : 0.12 + (Math.floor(uu * 6) % 2) * 0.3;
            g = v < 0.7 ? G("█") : G("▓");
            if (Math.abs(v - 0.88) < 0.04 && Math.abs(u - 0.5) < 0.12) {
              val = 0;
            }
          } else {
            // snow
            const n = hash1(x * 73856093 + y * 19349663 + tick * 83492791);
            const grain = n * n;
            const band = 0.5 + 0.5 * noise2(v * 18 + t * 9, t * 3); // horizontal interference
            val = (0.08 + grain * 0.62) * (0.7 + 0.3 * band) + bar * 0.25 + flip * 0.3;
            if (mode === "ghost") {
              // a broadcast trying to come through: a faint figure under the snow
              const fx = (u - 0.5) * 1.6, fy = (v - 0.55) * 1.2;
              const head = Math.hypot(fx, (fy + 0.28) * 1.2) < 0.13;
              const body = Math.abs(fx) < 0.24 - Math.max(0, -fy) * 0.1 && fy > -0.1 && fy < 0.5;
              if ((head || body) && n > 0.25) val = Math.max(val, 0.5);
            }
            g = STATIC[Math.min(STATIC.length - 1, (val * STATIC.length) | 0)];
            hue = n > 0.985 ? HUE.white : HUE.fg;
          }
          val *= 0.35 + 0.65 * vign;
          if (val < 0.04) continue;
          V[i] = val;
          H[i] = hue;
          Gg[i] = g;
          B[i] = 0.08 + val * 0.35;
          BH[i] = hue === HUE.fg ? HUE.alt : hue;
          continue;
        }

        // ── cabinet: dark plastic with a lit bevel around the screen ──
        let shade = 0.22 + 0.18 * clamp(-(py - by) / bh + 1); // lighter towards the top
        if (dScr < 1.2) shade = 0.5; // bezel lip
        if (dCab > -0.9) shade = 0.42; // outer edge
        V[i] = 0;
        B[i] = shade * 0.7;
        BH[i] = HUE.fg;
        // wood-grain lines on the cabinet
        if (dScr > 2 && dCab < -1.5 && hash1(Math.floor(py * 0.9) * 7 + 3) < 0.12 && hash1(x * 13 + Math.floor(py)) < 0.75) {
          V[i] = 0.08;
          H[i] = HUE.fg;
          Gg[i] = G("─");
        }
      }
    }

    // ── side panel: channel display, two knobs, speaker grille ──
    const P = (xp, yp) => [Math.round(xp), Math.round(yp * ax)];
    const cx = px + pw / 2;
    const [lx, ly] = P(cx - 3, sy + sh * 0.08);
    f.text(lx, ly, `CH ${ch}`, HUE.alt, 0.85);
    for (const [k, ky] of [[0, sy + sh * 0.32], [1, sy + sh * 0.56]]) {
      const r = pw * 0.28;
      for (let a = 0; a < 40; a++) {
        const ang = (a / 40) * Math.PI * 2;
        const [qx, qy] = P(cx + Math.cos(ang) * r, ky + Math.sin(ang) * r);
        f.set(qx, qy, 0.55, HUE.fg, G(Math.abs(Math.cos(ang)) > 0.8 ? "│" : Math.abs(Math.sin(ang)) > 0.8 ? "─" : "·"));
      }
      // pointer: the channel knob turns on every flip
      const pa = k === 0 ? -1.2 + CHANNELS.indexOf(ch) * 0.55 : -0.6 + Math.sin(t * 0.2) * 0.3;
      for (let s = 0.2; s < 0.95; s += 0.12) {
        const [qx, qy] = P(cx + Math.cos(pa) * r * s, ky + Math.sin(pa) * r * s);
        f.set(qx, qy, 0.8, HUE.main, G("•"));
      }
    }
    for (let gy = sy + sh * 0.76; gy < sy + sh * 0.98; gy += 1.4 / ax) {
      const [qx, qy] = P(cx - pw * 0.32, gy);
      for (let k = 0; k < Math.round(pw * 0.64); k++) f.set(qx + k, qy, 0.32, HUE.fg, G("="));
    }
    // brand plate under the screen
    const [tx, ty] = P(sx + sw / 2 - 4, sy + sh + (by + bh - sy - sh) * 0.45);
    f.text(tx, ty, "DELIRIUM", HUE.fg, 0.5);

    // OSD: channel number in the corner of the picture just after a flip
    if (flip > 0 || mode !== "static") {
      const [ox, oy] = P(sx + sw * 0.82, sy + sh * 0.08);
      f.text(ox, oy, ch, HUE.main, 0.95);
    }
    if (mode === "nosignal" && flip < 0.7) {
      const msg = "NO SIGNAL";
      const [nx, ny] = P(sx + sw / 2 - msg.length / 2, sy + sh / 2);
      for (let k = -2; k < msg.length + 2; k++) {
        const o = ny * cols + nx + k;
        if (o >= 0 && o < V.length) {
          V[o] = 0;
          B[o] = 0.55;
          BH[o] = HUE.alt;
        }
      }
      f.text(nx, ny, msg, HUE.white, 0.95);
    }

    // rabbit-ear antenna and legs
    const top = by - 0.2, mid = bx + bw * 0.42;
    const wob = Math.sin(t * 0.7) * 0.05;
    const reach = Math.max(2, (top - 1.5) / 0.85); // keep the tips on screen
    for (const [ang, len] of [[-2.2 + wob, Math.min(bh * 0.55, reach)], [-0.95 - wob, Math.min(bh * 0.6, reach)]]) {
      const [ax0, ay0] = P(mid, top);
      const [ax1, ay1] = P(mid + Math.cos(ang) * len, top + Math.sin(ang) * len);
      f.line(ax0, ay0, ax1, ay1, 0.45, HUE.fg, "auto", ax);
      f.set(ax1, ay1, 0.75, HUE.white, G("●"));
    }
    const [mx, my] = P(mid, top);
    f.set(mx - 1, my, 0.6, HUE.fg, G("▄"));
    f.set(mx, my, 0.6, HUE.fg, G("▄"));
    f.set(mx + 1, my, 0.6, HUE.fg, G("▄"));
    for (const lx2 of [bx + bw * 0.12, bx + bw * 0.88]) {
      const [qx, qy] = P(lx2, by + bh);
      for (let k = 1; k <= 3; k++) f.set(qx + (lx2 < mid ? -k * 0.5 : k * 0.5), qy + k, 0.4, HUE.fg, G(lx2 < mid ? "/" : "\\"));
    }
  },
};
