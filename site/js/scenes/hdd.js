// PROJECTS · Disk Check. An old hard drive with the cover off, seen from above: the platter spins
// under a seeking head while a defrag-style cluster map compacts one run of clusters at a time.
// Every move drives the head (low clusters live on the outer tracks), so the arm swings in step
// with the map. Hover the platter and the head follows the cursor.
import { HUE, G, TAU, clamp, hash1, rng, slopeGlyph } from "../engine/util.js";

const FREE = 0, USED = 1, FRAG = 2;
const OMEGA = 2.2; // platter spin, shown slowed down as if strobed (rad/s)
const G_SCREW = G("⊕"), G_HUB = G("◉"), G_BOLT = G("•"), G_HEAD = G("█"), G_ARM = G("▒");
const G_COIL = G("≡"), G_MAG = G("░"), G_PIN = G("▪"), G_LED = G("●"), G_DOT = G("·");
const BITS = [G("0"), G("1")];

let D = null; // geometry, physical units (cell widths; y already divided by the cell aspect)
let map = new Uint8Array(0), nB = 0, mCols = 0;
let op = null, phase = "seekR", phaseT = 0, bad0 = 1, pct = 0;
let rh = 0, rv = 0, target = 0, rnd = rng(1200);

/** a thin glyph along a contour whose physical outward normal is (nx, ny) */
const edgeGlyph = (nx, ny, ax) => slopeGlyph(-ny, nx * ax, ax);

function layout(S) {
  const { cols, rows, ax } = S;
  const W = cols, H = rows / ax;
  const land = W > H * 1.05;
  let bw, bh, bx, by, m;
  if (land) {
    bh = H * 0.84;
    bw = bh / 1.42;
    bx = Math.max(3, W * 0.07);
    by = (H - bh) / 2 - 1;
    m = { x0: Math.ceil(bx + bw + W * 0.06), x1: cols - 4, y0: Math.ceil(by * ax) + 4, y1: Math.floor((by + bh) * ax) - 2 };
  } else {
    bw = Math.min(W * 0.8, (H * 0.6) / 1.42);
    bh = bw * 1.42;
    bx = (W - bw) / 2;
    by = 4 / ax;
    m = { x0: Math.round(bx), x1: Math.round(bx + bw), y0: Math.ceil((by + bh) * ax) + 6, y1: rows - 5 };
  }
  m.y1 = Math.min(m.y1, m.y0 + 22);
  if (land) {
    // beside the drive: a block of at most ~120 columns, centred on it
    const mid = Math.round((by + bh / 2) * ax), n = m.y1 - m.y0;
    m.y0 = mid - Math.floor(n / 2);
    m.y1 = m.y0 + n;
    const w = Math.min(m.x1 - m.x0, 120);
    m.x0 += Math.floor((m.x1 - m.x0 - w) / 2);
    m.x1 = m.x0 + w;
  }
  const R = bw * 0.455;
  const cx = bx + bw * 0.5, cy = by + bh * 0.355;
  const px = bx + bw * 0.83, py = by + bh * 0.8;
  const d = Math.hypot(cx - px, cy - py);
  D = {
    ax, bx, by, bw, bh, rc: bw * 0.05,
    cx, cy, R, hub: R * 0.2,
    px, py, la: d * 0.93, base: Math.atan2(cy - py, cx - px), d,
    rIn: R * 0.3, rOut: R * 0.92, trackW: Math.max(1.3, R / 26),
    m,
  };
  // the coil and magnet sit behind the pivot, opposite the arm at mid-stroke
  D.aMid = headAt((D.rIn + D.rOut) / 2)[2] + Math.PI;
}

/** head position for a track radius: where the arm's circle meets the track circle */
function headAt(r) {
  const ca = clamp((D.la * D.la + D.d * D.d - r * r) / (2 * D.la * D.d), -1, 1);
  const a = D.base - Math.acos(ca);
  return [D.px + Math.cos(a) * D.la, D.py + Math.sin(a) * D.la, a];
}

const trackOf = (i) => D.rOut - (i / Math.max(1, nB - 1)) * (D.rOut - D.rIn);

function scramble() {
  let i = 0;
  while (i < nB) {
    const r = rnd();
    let type = r < 0.5 ? USED : r < 0.76 ? FREE : FRAG;
    const len = type === USED ? 6 + rnd() * 40 : type === FREE ? 3 + rnd() * 26 : 2 + rnd() * 12;
    if (i > nB * 0.8 && type !== FREE && rnd() < 0.75) type = FREE; // the far end is mostly empty
    for (let k = 0; k < len && i < nB; k++) map[i++] = type;
  }
  bad0 = Math.max(1, badness());
  pct = 0;
}

/** fragmented clusters plus holes in front of the last used one */
function badness() {
  let last = -1, frag = 0;
  for (let i = 0; i < nB; i++) {
    if (map[i] !== FREE) last = i;
    if (map[i] === FRAG) frag++;
  }
  let holes = 0;
  for (let i = 0; i < last; i++) if (map[i] === FREE) holes++;
  return frag + holes;
}

/** next move: the first fragmented run (rewritten into the first free clusters, or in place if it
 * already sits in front of them), else the last run on the disk pulled forward into the holes */
function nextOp() {
  const w = map.indexOf(FREE);
  let s = map.indexOf(FRAG), src = [];
  if (s >= 0) {
    while (s < nB && map[s] === FRAG && src.length < 24) src.push(s++);
  } else {
    let e = nB - 1;
    while (e >= 0 && map[e] === FREE) e--;
    if (w < 0 || e < w) return null;
    while (e > w && map[e] === USED && src.length < 24) src.unshift(e--);
  }
  if (!src.length) return null;
  let dst = [];
  if (w < 0 || src[0] < w) dst = src.slice();
  else for (let i = w; i < nB && dst.length < src.length; i++) if (map[i] === FREE || src.includes(i)) dst.push(i);
  return { src, dst };
}

function commit() {
  for (const i of op.src) map[i] = FREE;
  for (const i of op.dst) map[i] = USED;
  pct = clamp(1 - badness() / bad0);
}

function advance(dt, hover) {
  if (hover !== null) {
    target = hover;
    return;
  }
  phaseT += dt;
  const settled = Math.abs(rh - target) < 0.35 && Math.abs(rv) < 4;
  if (!op && phase !== "done") {
    op = nB ? nextOp() : null;
    if (!op) {
      phase = nB ? "done" : "seekR";
      phaseT = 0;
      if (!nB) target = D.rIn + rnd() * (D.rOut - D.rIn);
    } else phase = "seekR";
  }
  const dur = op ? 0.18 + op.src.length * 0.014 : 0;
  // while reading or writing a run the head creeps across its clusters
  const along = (list) => trackOf(list[Math.min(list.length - 1, Math.floor((phaseT / dur) * list.length))]);
  if (phase === "seekR") {
    if (op) target = trackOf(op.src[0]);
    if (settled && phaseT > 0.08) {
      phase = op ? "read" : "seekR";
      phaseT = 0;
      if (!op) target = D.rIn + rnd() * (D.rOut - D.rIn);
    }
  } else if (phase === "read") {
    target = along(op.src);
    if (phaseT > dur) {
      phase = "seekW";
      phaseT = 0;
    }
  } else if (phase === "seekW") {
    target = trackOf(op.dst[0]);
    if (settled && phaseT > 0.08) {
      phase = "write";
      phaseT = 0;
    }
  } else if (phase === "write") {
    target = along(op.dst);
    if (phaseT > dur) {
      commit();
      op = null;
      phaseT = 0;
    }
  } else if (phase === "done") {
    target = D.rOut + (D.R - D.rOut) * 0.6; // park near the edge
    if (phaseT > 3.2) {
      scramble();
      phase = "seekR";
      phaseT = 0;
    }
  }
}

/** servo: a stiff, slightly underdamped spring, so seeks overshoot a hair and settle */
function servo(dt) {
  const k = 1100, c = 2 * 0.62 * Math.sqrt(k);
  const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
  for (let i = 0; i < n; i++) {
    rv += (k * (target - rh) - c * rv) * h;
    rh += rv * h;
  }
}

export default {
  id: "hdd",
  title: "DEFRAG_C",

  init(f, S) {
    f.useBg = true;
    f.bgGap = 0.24; // cluster tiles with a little space between them
    const oldN = nB;
    layout(S);
    const { m } = D;
    mCols = Math.max(0, m.x1 - m.x0);
    const mRows = Math.max(0, m.y1 - m.y0);
    const n = mCols >= 12 && mRows >= 4 ? mCols * mRows : 0;
    if (n !== oldN) {
      nB = n;
      map = new Uint8Array(nB);
      scramble();
      op = null;
      phase = "seekR";
      rh = target = D.rOut;
      rv = 0;
    }
  },

  frame(f, t, dt, S, input) {
    const { cols, rows, ax } = S;
    f.clear();
    const { bx, by, bw, bh, cx, cy, R, hub, px, py, m } = D;

    // ── head control: the cursor over the platter, otherwise the defrag ──
    let hover = null;
    if (input.inside) {
      const r = Math.hypot(input.x + 0.5 - cx, (input.y + 0.5) / ax - cy);
      if (r < R) hover = clamp(r, D.rIn, D.rOut);
    }
    advance(dt, hover);
    servo(dt);
    const [hx, hy, aArm] = headAt(rh);
    const settled = Math.abs(rh - target) < 0.6;
    const act = hover !== null ? 1 : settled && phase === "read" ? 1 : settled && phase === "write" ? 2 : 0;
    const rot = OMEGA * t;
    const thHead = Math.atan2(hy - cy, hx - cx);
    const tick = Math.floor(t * 12);

    // ── the drive, cell by cell ──
    const x0 = Math.max(0, Math.floor(bx) - 1), x1 = Math.min(cols - 1, Math.ceil(bx + bw) + 1);
    const y0 = Math.max(0, Math.floor(by * ax) - 1), y1 = Math.min(rows - 1, Math.ceil((by + bh) * ax) + 1);
    const ux = Math.cos(aArm), uy = Math.sin(aArm); // arm direction, pivot → head
    const wP = bw * 0.075, wH = bw * 0.02;
    const pr = bw * 0.065; // pivot bearing radius
    for (let y = y0; y <= y1; y++) {
      const fy = (y + 0.5) / ax;
      for (let x = x0; x <= x1; x++) {
        const fx = x + 0.5;
        // rounded body outline
        const qx = Math.abs(fx - (bx + bw / 2)) - bw / 2 + D.rc, qy = Math.abs(fy - (by + bh / 2)) - bh / 2 + D.rc;
        const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - D.rc;
        if (sd > 0.55) continue;
        if (sd > -0.55) {
          let nx = qx > 0 ? Math.sign(fx - (bx + bw / 2)) : 0, ny = qy > 0 ? Math.sign(fy - (by + bh / 2)) : 0;
          if (!nx && !ny) (qx > qy ? (nx = Math.sign(fx - (bx + bw / 2))) : (ny = Math.sign(fy - (by + bh / 2))));
          f.set(x, y, 0.55, HUE.fg, edgeGlyph(nx, ny, ax));
          continue;
        }

        // arm (topmost): a tapered stamped-steel bar with a lightening slot
        const ax_ = fx - px, ay_ = fy - py;
        const along = ax_ * ux + ay_ * uy, across = Math.abs(-ax_ * uy + ay_ * ux);
        const u = along / D.la;
        if (u > -0.02 && u < 1.04) {
          const half = wP + (wH - wP) * clamp(u);
          if (across <= half && !(u > 0.28 && u < 0.66 && across < half * 0.38)) {
            if (u > 0.97) f.set(x, y, 0.95, HUE.white, G_HEAD);
            else if (half - across < 0.75) f.set(x, y, 0.62, HUE.fg, slopeGlyph(ux, uy * ax, ax));
            else f.set(x, y, 0.4, HUE.fg, G_ARM);
            continue;
          }
        }

        // pivot bearing, then the voice coil (moves with the arm) over its magnet (fixed)
        const dp = Math.hypot(ax_, ay_), ap = Math.atan2(ay_, ax_);
        if (dp < pr) {
          f.set(x, y, dp < pr * 0.4 ? 0.9 : 0.5, HUE.fg, dp < pr * 0.4 ? G_HUB : edgeGlyph(ax_, ay_, ax));
          continue;
        }
        if (dp < bw * 0.2) {
          if (dp > bw * 0.075 && dp < bw * 0.165 && Math.abs(wrap(ap - aArm - Math.PI)) < 0.5) {
            f.set(x, y, 0.55, HUE.main, G_COIL);
            continue;
          }
          if (Math.abs(wrap(ap - D.aMid)) < 0.95) {
            f.set(x, y, 0.2, HUE.fg, G_MAG);
            continue;
          }
        }

        // platter
        const dx = fx - cx, dy = fy - cy, r = Math.hypot(dx, dy);
        if (r <= R) {
          const th = Math.atan2(dy, dx);
          // a mirror finish: broad reflections fixed in space, brighter toward the rim
          const lobe = Math.exp(-(wrap(th + 0.95) ** 2) / 0.14) + 0.55 * Math.exp(-(wrap(th + 0.95 - Math.PI) ** 2) / 0.14);
          const sheen = lobe * (0.45 + 0.55 * (r / R));
          if (r < hub) {
            // spindle hub with its clamp screws turning
            const sa = wrap(th - rot) * 3 / Math.PI;
            const screw = r > hub * 0.45 && r < hub * 0.8 && Math.abs(sa - Math.round(sa)) < 0.16;
            if (r < hub * 0.22) f.set(x, y, 0.9, HUE.white, G_HUB);
            else if (screw) f.set(x, y, 0.85, HUE.fg, G_BOLT);
            else f.plot(x, y, 0.32 + sheen * 0.3, HUE.fg);
            continue;
          }
          if (r < hub * 1.2) {
            f.set(x, y, 0.45, HUE.fg, edgeGlyph(dx, dy, ax));
            continue;
          }
          if (r > R - 0.9) {
            f.set(x, y, 0.5 + sheen * 0.3, HUE.fg, edgeGlyph(dx, dy, ax));
            continue;
          }
          // concentric tracks; sectors per track grow with the radius (zoned recording)
          const tr = (r - hub * 1.3) / D.trackW;
          const k = Math.floor(tr);
          const groove = tr - k < 0.5;
          const nSec = Math.max(8, Math.round(r * 1.1));
          const sec = Math.floor((((th - rot) % TAU) + TAU) % TAU / (TAU / nSec));
          const bit = hash1(k * 977 + sec * 131) > 0.5 ? 1 : 0;
          // the track under the head lights up behind it as it is read or written
          if (act && Math.abs(r - rh) < D.trackW * 1.1) {
            const behind = ((th - thHead) % TAU + TAU) % TAU;
            const glow = Math.exp(-behind * 1.2);
            if (glow > 0.05) {
              f.set(x, y, 0.3 + glow * 0.7, act === 2 ? HUE.hot : HUE.main, BITS[bit]);
              continue;
            }
          }
          if (groove) f.set(x, y, 0.1 + sheen * 0.42 + bit * 0.05, HUE.fg, edgeGlyph(dx, dy, ax));
          else if (sheen > 0.35) f.plot(x, y, sheen * 0.16, HUE.fg);
          continue;
        }
        // the cast well around the platter, then the brushed casing
        if (r < R + 1.4) continue;
        if (r < R + 2.1) {
          f.set(x, y, 0.2, HUE.fg, edgeGlyph(dx, dy, ax));
          continue;
        }
        const brush = hash1(Math.floor(fx + fy * 0.6) * 31 + y * 7);
        if (brush > 0.8) f.plot(x, y, 0.06 + brush * 0.04, HUE.fg);
      }
    }

    // screws on the frame
    const ins = Math.max(2.2, bw * 0.045);
    for (const [sx, sy] of [[ins, ins], [bw - ins, ins], [ins, bh - ins], [bw - ins, bh - ins], [ins, bh * 0.52], [bw - ins, bh * 0.6]]) {
      f.set(Math.floor(bx + sx), Math.floor((by + sy) * ax), 0.75, HUE.fg, G_SCREW);
    }
    // flex cable from the pivot to the connector, with bits riding it while the head works
    const c0x = px + bw * 0.07, c0y = py + bh * 0.02, c1x = bx + bw * 0.62, c1y = by + bh - 1.2;
    const cmx = bx + bw * 0.93, cmy = by + bh * 0.9;
    const bez = (s) => [(1 - s) ** 2 * c0x + 2 * (1 - s) * s * cmx + s * s * c1x, (1 - s) ** 2 * c0y + 2 * (1 - s) * s * cmy + s * s * c1y];
    for (let s = 0; s <= 1; s += 0.02) {
      const [qx, qy] = bez(s);
      f.plot(Math.floor(qx), Math.floor(qy * ax), 0.22, HUE.fg, G_DOT);
    }
    if (act) {
      for (let j = 0; j < 6; j++) {
        const s = ((t * 0.9 + j / 6) % 1);
        const [qx, qy] = bez(act === 2 ? 1 - s : s);
        f.set(Math.floor(qx), Math.floor(qy * ax), 0.85, act === 2 ? HUE.hot : HUE.main, BITS[(j + tick) & 1]);
      }
    }
    // label, activity LED and the IDE connector
    const lx = Math.round(bx + bw * 0.08), ly = Math.round((by + bh * 0.83) * ax);
    if (bw > 40) {
      f.text(lx, ly, "DELIRIUM DLR-1200A", HUE.fg, 0.5);
      f.text(lx, ly + 1, "7200 RPM  1.2 GB  IDE", HUE.fg, 0.32);
    }
    const ledOn = act && hash1(tick * 13) > 0.3;
    f.set(Math.round(bx + bw * 0.08), Math.round((by + bh - ins) * ax) - 1, ledOn ? 1 : 0.18, ledOn ? HUE.hot : HUE.fg, G_LED);
    const pinY = Math.round((by + bh) * ax) + 1;
    for (let x = Math.round(bx + bw * 0.16); x < bx + bw * 0.56; x += 2) {
      f.set(x, pinY, 0.45, HUE.fg, G_PIN);
      f.set(x + 1, pinY, 0.3, HUE.fg, G_PIN);
    }

    // ── the cluster map ──
    if (!nB) return;
    const B = f.b, BH = f.bh;
    const blink = (tick & 1) === 1;
    const hot = new Map();
    if (op && (phase === "read" || phase === "write" || phase === "seekR" || phase === "seekW")) {
      const reading = phase === "read" || phase === "seekR";
      for (const i of reading ? op.src : op.dst) hot.set(i, reading ? 1 : 2);
    }
    for (let i = 0; i < nB; i++) {
      const x = m.x0 + (i % mCols), y = m.y0 + Math.floor(i / mCols);
      const o = y * cols + x;
      if (o < 0 || o >= B.length) continue;
      const h = hot.get(i);
      if (h === 1) {
        B[o] = blink ? 0.95 : 0.7;
        BH[o] = HUE.white;
      } else if (h === 2) {
        B[o] = 0.9;
        BH[o] = HUE.main;
      } else if (map[i] === USED) {
        B[o] = 0.34;
        BH[o] = HUE.alt;
      } else if (map[i] === FRAG) {
        B[o] = 0.58;
        BH[o] = HUE.hot;
      } else {
        B[o] = 0.08;
        BH[o] = HUE.fg;
      }
    }
    // header and legend
    const pctS = String(Math.round(pct * 100)).padStart(3) + "%";
    f.text(m.x0, m.y0 - 2, "C:\\ DEFRAG" + pctS, HUE.fg, 0.75);
    const cl = op ? op[phase === "write" || phase === "seekW" ? "dst" : "src"][0] : 0;
    const status =
      hover !== null ? "MANUAL SEEK" :
      phase === "done" ? "COMPLETE" :
      phase === "read" ? "READ  " + String(cl).padStart(5, "0") :
      phase === "write" ? "WRITE " + String(cl).padStart(5, "0") : "SEEK";
    f.text(m.x1 - status.length, m.y0 - 2, status, phase === "write" ? HUE.hot : HUE.main, 0.9);
    const legend = [["in place", HUE.alt], ["fragmented", HUE.hot], ["reading", HUE.white], ["writing", HUE.main]];
    let lxx = m.x0;
    const ly2 = m.y1 + 1;
    for (const [label, hue] of legend) {
      if (lxx + label.length + 2 > m.x1) break;
      f.set(lxx, ly2, 0.9, hue, G("■"));
      f.text(lxx + 2, ly2, label, HUE.fg, 0.5);
      lxx += label.length + 4;
    }
  },
};

function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
