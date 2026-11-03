/**
 * Hairpin winding engine — dependency-free ES module port of winding_engine.py
 * and winding_diagram.py (integer-slot, 3-phase, distributed hairpin windings).
 *
 *   buildWinding({Qs, poles, layers, y_c, paths, terminals}) -> winding object
 *   windingSVG(w, {width})                                  -> SVG string
 *
 * Conventions follow the Python: slots 0..Qs-1 (CCW), layer 1 = bore side,
 * direction +1 = current flows from the weld side toward the crown side.
 * Conductors are identified by [slot, layer]; dictionaries keyed on conductors
 * use the string key "slot,layer" (Python used tuples).
 */

export const BELTS = [["A", +1], ["C", -1], ["B", +1], ["A", -1], ["C", +1], ["B", -1]];
export const PHASES = ["A", "B", "C"];

export class WindingError extends Error {
  constructor(msg) { super(msg); this.name = "WindingError"; }
}

// ------------------------------------------------------------ Python helpers
/** Python-style modulo (result takes the sign of the divisor). */
function mod(a, n) {
  const m = a % n;
  return m !== 0 && (m < 0) !== (n < 0) ? m + n : m;
}
/** Python-style round(x, nd): round to nearest, exact ties to even. */
function pyRound(x, nd) {
  const f = 10 ** nd;
  const lo = Math.floor(x * f);
  if ((lo + 0.5) / f === x) {                     // exact binary tie
    return (lo % 2 === 0 ? lo : lo + 1) / f;
  }
  return Number(x.toFixed(nd));
}
/** Complex arithmetic on [re, im] pairs, mirroring CPython's complex ops. */
const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cabs = (a) => Math.hypot(a[0], a[1]);
const cexpi = (ang) => [Math.cos(ang), Math.sin(ang)];   // exp(1j*ang)
function cdiv(a, b) {                                  // CPython _Py_c_quot
  const abr = Math.abs(b[0]), abi = Math.abs(b[1]);
  if (abr >= abi) {
    if (abr === 0) throw new Error("complex division by zero");
    const ratio = b[1] / b[0], denom = b[0] + b[1] * ratio;
    return [(a[0] + a[1] * ratio) / denom, (a[1] - a[0] * ratio) / denom];
  }
  const ratio = b[0] / b[1], denom = b[0] * ratio + b[1];
  return [(a[0] * ratio + a[1]) / denom, (a[1] * ratio - a[0]) / denom];
}
const key = (sl, l) => sl + "," + l;
const DEG = 180 / Math.PI, RAD = Math.PI / 180;

// ------------------------------------------------------------ WindingSpec
export function makeSpec({ Qs = 24, poles = 4, layers = 4, y_c = null, paths = 1, terminals = "6lead" } = {}) {
  const s = { Qs, poles, layers, y_c, paths, terminals };
  const p = Math.trunc(poles / 2);
  if (poles % 2 || poles < 2) throw new WindingError("poles must be even");
  if (Qs % (3 * poles)) {
    throw new WindingError(`q = Qs/(3*2p) = ${Qs}/${3 * poles} is not an integer; ` +
      "only integer-slot windings are supported for now");
  }
  if (layers % 2 || layers < 2) throw new WindingError("layers must be even (hairpins fill layer pairs)");
  s.p = p;
  s.tau = Math.trunc(Qs / poles);
  s.q = Math.trunc(Qs / (3 * poles));
  if (s.y_c === null || s.y_c === undefined) s.y_c = s.tau;
  if (!(s.tau - s.q < s.y_c && s.y_c <= s.tau)) {
    throw new WindingError(`crown pitch must be in (${s.tau - s.q}, ${s.tau}] ` +
      "(short pitch by less than one phase belt)");
  }
  if (paths !== 1 && paths !== 2) throw new WindingError("paths must be 1 or 2");
  if (terminals !== "6lead" && terminals !== "star") throw new WindingError("terminals must be '6lead' or 'star'");
  s.y_w = 2 * s.tau - s.y_c;
  s.t_o = Math.trunc(s.y_w / 2);        // odd layers twist this many slots CW (-)
  s.t_e = s.y_w - s.t_o;                // even layers twist CCW (+)
  s.d_even = s.y_c - s.tau;             // belt shift of even layers (0 or negative)
  return s;
}

// ------------------------------------------------------------ phase belts
export function belt(s, slot, layer) {
  const shift = layer % 2 === 0 ? s.d_even : 0;
  const j = mod(slot - shift, s.Qs);
  return BELTS[mod(Math.trunc(j / s.q), 6)];
}
const phaseOffset = (s, ph) => ({ A: 0, B: 2, C: 4 })[ph] * s.q;

// ------------------------------------------------------------ construction
function build(s) {
  const Q = s.Qs, L = s.layers;
  const w = { s, pins: [], welds: [], jumpers: [], terminals: [], specialBelts: [], switch: {}, branches: {} };
  // 1. crown pins, regular pitch, all layer pairs, all phases: (odd slot, pair) -> even slot
  const target = new Map();                       // key "a,pair" -> b
  for (let pair = 0; pair < L / 2; pair++) {
    for (let a = 0; a < Q; a++) target.set(key(a, pair), mod(a + s.y_c, Q));
  }
  // 2. cyclic shift in one belt per phase, polarity set and pair -> merges q loops
  if (s.q > 1) {
    for (const ph of PHASES) {
      const off = phaseOffset(s, ph);
      for (const [pset, base] of [["F", off], ["R", off + s.tau]]) {   // odd + belt / odd - belt
        for (let pair = 0; pair < L / 2; pair++) {
          for (let i = 0; i < s.q; i++) {
            const a = mod(base + i, Q);
            target.set(key(a, pair), mod(base + s.y_c + mod(i + 1, s.q), Q));
          }
          w.specialBelts.push([ph, pset, pair, mod(base, Q)]);
        }
      }
    }
  }
  const items = [...target].map(([k, b]) => { const [a, pair] = k.split(",").map(Number); return [a, pair, b]; });
  items.sort((u, v) => (u[1] - v[1]) || (u[0] - v[0]));   // sorted by (pair, a) like Python
  for (const [a, pair, b] of items) {
    const lo = 2 * pair + 1, hi = 2 * pair + 2;
    const [ph] = belt(s, a, lo);
    const pitch = mod(b - a, Q);
    w.pins.push({ phase: ph, a, la: lo, b, lb: hi, pitch, special: pitch !== s.y_c });
  }
  // 3. switched weld locations, chosen to keep the jumper short
  for (const ph of PHASES) {
    const locF = [], locR = [];
    for (let x = 0; x < Q; x++) {
      const [bph, sg] = belt(s, x - s.t_e, 2);
      if (bph === ph && sg === -1) locF.push(x);
      if (bph === ph && sg === +1) locR.push(x);
    }
    let best = null;                                 // Python: min over tuples (dist, r, f)
    for (const f of locF) {
      for (const r of locR) {
        const t = [Math.min(mod(f - r, Q), mod(r - f, Q)), r, f];
        if (best === null || t[0] < best[0] || (t[0] === best[0] && (t[1] < best[1] || (t[1] === best[1] && t[2] < best[2])))) best = t;
      }
    }
    w.switch[ph] = { F: best[2], R: best[1] };
  }
  const swLocs = new Map();
  for (const ph of PHASES) for (const v of Object.values(w.switch[ph])) swLocs.set(v, ph);
  // 4. welds
  for (let x = 0; x < Q; x++) {
    const se = mod(x - s.t_e, Q), so = mod(x + s.t_o, Q);
    const ph = belt(s, se, 2)[0];
    if (swLocs.has(x)) {
      for (let l = 2; l < L; l += 2) {               // L2-L3, L4-L5, ...
        w.welds.push({ phase: ph, loc: x, ends: [[se, l], [so, l + 1]], switched: true });
      }
    } else {
      for (let l = 1; l < L; l += 2) {               // L1-L2, L3-L4, ...
        w.welds.push({ phase: ph, loc: x, ends: [[so, l], [se, l + 1]], switched: false });
      }
    }
  }
  // 5. path ends, jumpers, terminals
  for (const ph of PHASES) {
    const xF = w.switch[ph].F, xR = w.switch[ph].R;
    const R_in = [mod(xR - s.t_e, Q), L], R_out = [mod(xR + s.t_o, Q), 1];
    const F_in = [mod(xF + s.t_o, Q), 1], F_out = [mod(xF - s.t_e, Q), L];
    const ends = new Map([[key(...R_in), xR], [key(...R_out), xR], [key(...F_in), xF], [key(...F_out), xF]]);
    let starts, finishes;
    if (s.paths === 1) {
      w.jumpers.push({ phase: ph, conds: [R_out, F_in], locs: [xR, xF] });
      w.branches[ph] = [[R_in, F_out]];
      starts = [R_in]; finishes = [F_out];
    } else {
      w.branches[ph] = [[R_in, R_out], [F_in, F_out]];
      starts = [R_in, F_in]; finishes = [R_out, F_out];
    }
    w.terminals.push({ phase: ph, kind: "start", conds: starts, locs: starts.map((c) => ends.get(key(...c))) });
    w.terminals.push({ phase: ph, kind: "end", conds: finishes, locs: finishes.map((c) => ends.get(key(...c))) });
  }
  return w;
}

// ------------------------------------------------------------ tracing
function trace(w, ph) {
  const crown = new Map(), link = new Map();
  for (const p of w.pins) {
    if (p.phase !== ph) continue;
    const A = key(p.a, p.la), B = key(p.b, p.lb);
    if (crown.has(A) || crown.has(B)) throw new WindingError(`${ph}: conductor in two hairpins`);
    crown.set(A, [p.b, p.lb]); crown.set(B, [p.a, p.la]);
  }
  for (const wd of w.welds) {
    if (wd.phase !== ph) continue;
    const [A, B] = wd.ends;
    if (link.has(key(...A)) || link.has(key(...B))) throw new WindingError(`${ph}: conductor welded twice`);
    link.set(key(...A), B); link.set(key(...B), A);
  }
  for (const j of w.jumpers) {
    if (j.phase !== ph) continue;
    const [A, B] = j.conds;
    link.set(key(...A), B); link.set(key(...B), A);
  }
  const out = [];
  for (const [start, finish] of w.branches[ph]) {
    let cur = start, side = "weld";
    const seen = new Set(), path = [];
    const fin = key(...finish);
    for (;;) {
      const k = key(...cur);
      if (seen.has(k)) throw new WindingError(`${ph}: closed loop at (${cur[0]}, ${cur[1]})`);
      seen.add(k);
      path.push([cur[0], cur[1], side === "weld" ? +1 : -1]);
      if (side === "weld") {
        cur = crown.get(k); side = "crown";
      } else {
        if (k === fin) break;
        if (!link.has(k)) throw new WindingError(`${ph}: open end at (${cur[0]}, ${cur[1]})`);
        cur = link.get(k); side = "weld";
      }
    }
    out.push(path);
  }
  return out;
}

// ------------------------------------------------------------ checks
/** Phasor EMF of a path: sum d * exp(-j h p theta(slot)). */
export function emf(w, path, harmonic = 1) {
  const s = w.s;
  let acc = [0, 0];
  for (const [sl, , d] of path) {
    const th = 2 * Math.PI * sl / s.Qs;
    const e = cexpi(-(harmonic * s.p) * th);       // d * exp(-1j*h*p*th)
    acc = cadd(acc, [d * e[0], d * e[1]]);
  }
  return acc;
}

function verify(w) {
  const s = w.s;
  const rep = {
    spec: { Qs: s.Qs, poles: s.poles, q: s.q, layers: s.layers, y_c: s.y_c, y_w: s.y_w,
            tau: s.tau, twist: [s.t_o, s.t_e], paths: s.paths, terminals: s.terminals },
  };
  const used = new Set();
  const nBranch = Math.trunc(Math.trunc(s.Qs * s.layers / 3) / s.paths);
  for (const ph of PHASES) {
    for (const path of w.paths[ph]) {
      if (path.length !== nBranch) throw new WindingError(`${ph}: branch has ${path.length} conductors, expected ${nBranch}`);
      for (const [sl, l, d] of path) {
        const [bph, sg] = belt(s, sl, l);
        if (bph !== ph) throw new WindingError(`${ph}: slot ${sl} L${l} belongs to phase ${bph}`);
        if (d !== sg) throw new WindingError(`${ph}: wrong current direction in slot ${sl} L${l}`);
        if (used.has(key(sl, l))) throw new WindingError(`slot ${sl} L${l} used twice`);
        used.add(key(sl, l));
      }
    }
  }
  if (used.size !== s.Qs * s.layers) throw new WindingError("not all conductors used");
  // EMF balance and parallel branch equality
  const E = {};
  for (const ph of PHASES) {
    const br = w.paths[ph].map((pth) => emf(w, pth));
    if (s.paths === 2 && cabs(csub(br[0], br[1])) > 1e-6 * cabs(br[0])) {
      throw new WindingError(`${ph}: parallel branches have different EMF (circulating current)`);
    }
    E[ph] = br[0];
  }
  const mags = PHASES.map((ph) => cabs(E[ph]));
  if (Math.max(...mags) - Math.min(...mags) > 1e-6 * Math.max(...mags)) throw new WindingError("phase EMFs unequal");
  const ang = PHASES.map((ph) => Math.atan2(E[ph][1], E[ph][0]) * DEG);
  const dAB = mod(ang[0] - ang[1], 360), dBC = mod(ang[1] - ang[2], 360);
  if (Math.abs(dAB - 120) > 1e-6 || Math.abs(dBC - 120) > 1e-6) {
    throw new WindingError(`phase displacement not 120 deg: ${dAB.toFixed(1)}, ${dBC.toFixed(1)}`);
  }
  rep.phase_angles_deg = ang.map((a) => pyRound(a, 2));
  const kw = {};
  for (const h of [1, 5, 7, 11, 13]) kw[h] = pyRound(cabs(emf(w, w.paths.A[0], h)) / nBranch, 4);
  rep.winding_factor = kw;
  rep.series_turns_per_phase = Math.trunc(nBranch / 2);      // one turn = two conductors
  rep.hairpins = w.pins.length;
  rep.special_pins = w.pins.filter((p) => p.special).length;
  rep.special_pitches = [...new Set(w.pins.filter((p) => p.special).map((p) => p.pitch))].sort((a, b) => a - b);
  rep.welds = w.welds.length;
  rep.switched_welds = w.welds.filter((x) => x.switched).length;
  rep.jumpers = w.jumpers.length;
  rep.jumper_span_slots = w.jumpers.map((j) => Math.min(mod(j.locs[1] - j.locs[0], s.Qs), mod(j.locs[0] - j.locs[1], s.Qs)));
  rep.switch_locations = w.switch;
  rep.inslot_neighbour_voltage = neighbourVoltage(w);
  return rep;
}

/** Phasor potential of each conductor (no-load, star, phase peak = 1) at its midpoint. */
export function potentials(w) {
  const s = w.s;
  const V = new Map();
  for (const ph of PHASES) {
    for (const path of w.paths[ph]) {
      const e = path.map(([sl, , d]) => {
        const z = cexpi(-2 * s.p * Math.PI * sl / s.Qs);      // exp(-1j*p*2*pi*sl/Qs)
        return [d * z[0], d * z[1]];
      });
      let tot = [0, 0];
      for (const ek of e) tot = cadd(tot, ek);
      const scale = cdiv(cexpi(({ A: 0, B: -120, C: 120 })[ph] * RAD), tot);
      let rem = tot;
      path.forEach(([sl, l], i) => {
        const ek = e[i];
        V.set(key(sl, l), cmul(csub(rem, [ek[0] / 2, ek[1] / 2]), scale));
        rem = csub(rem, ek);
      });
    }
  }
  return V;
}

/** Worst voltage between radially adjacent conductors in the same slot (x phase peak). */
export function neighbourVoltage(w) {
  const s = w.s, V = potentials(w);
  let worst = 0, same = 0, cross = 0;
  for (let sl = 0; sl < s.Qs; sl++) {
    for (let l = 1; l < s.layers; l++) {
      const dv = cabs(csub(V.get(key(sl, l)), V.get(key(sl, l + 1))));
      worst = Math.max(worst, dv);
      if (belt(s, sl, l)[0] === belt(s, sl, l + 1)[0]) same = Math.max(same, dv);
      else cross = Math.max(cross, dv);
    }
  }
  return { max: pyRound(worst, 3), same_phase: pyRound(same, 3), phase_to_phase: pyRound(cross, 3) };
}

/** Series path as text, 1-based slots: "1L1+ 7L2- ...". */
export function sequence(w, ph) {
  return w.paths[ph].map((pth) => pth.map(([sl, l, d]) => `${sl + 1}L${l}${d > 0 ? "+" : "-"}`).join(" "));
}

// ------------------------------------------------------------ public entry
/**
 * Build, trace and verify a winding. Throws WindingError (an Error) with the
 * same message text as the Python engine for invalid or inconsistent specs.
 */
export function buildWinding(spec = {}) {
  const s = makeSpec(spec);
  const w = build(s);
  w.paths = {};
  for (const ph of PHASES) w.paths[ph] = trace(w, ph);
  w.report = verify(w);
  w.belt = (slot, layer) => belt(s, slot, layer);
  w.sequence = (ph) => sequence(w, ph);
  return w;
}

// ============================================================ developed diagram
const COL = { A: "#c8312a", B: "#e8b524", C: "#2a64c4" };
const NAME = { A: "U", B: "V", C: "W" };
const TERM = { "6lead": { start: (n) => `${n}1`, end: (n) => `${n}2` }, star: { start: (n) => n, end: () => "N" } };
const FONT = "IBM Plex Mono, monospace";
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (v) => (Math.round(v * 100) / 100).toString();

/**
 * Developed (unrolled) winding diagram as an SVG string, equivalent to
 * winding_diagram.draw(): core band, conductors with current arrows, crown pins
 * below, weld side above with tips/weld bars, switched welds, jumpers, terminals.
 * opts.width sets the viewBox width (default 1200); the SVG scales responsively.
 */
export function windingSVG(w, opts = {}) {
  const s = w.s, Q = s.Qs, L = s.layers;
  const W = opts.width || 1200;
  const lane = 0.62 / L;
  const X = (slot, layer) => slot + (layer - (L + 1) / 2) * lane;
  // data window (slot units horizontally, diagram units vertically, y up)
  const xmin = -0.8, xmax = Q + 0.3, ymin = -3.7, ymax = 4.05;   // same margin at the wrap edge
  const sx = W / (xmax - xmin), sy = 1.5 * sx;
  const H = (ymax - ymin) * sy;
  const px = (x) => fmt((x - xmin) * sx), py = (y) => fmt((ymax - y) * sy);
  const lw = (pt) => fmt(pt * 0.023 * sx);                 // matplotlib points -> px
  const fs = (pt) => fmt(pt * 0.0225 * sx);                // font size, points -> px
  const out = [];
  const seg = (x0, y0, x1, y1, attrs) => {               // repeated at +-Q for wrap-around
    for (const sh of [-Q, 0, Q]) {
      if (Math.max(x0, x1) + sh < xmin || Math.min(x0, x1) + sh > xmax) continue;
      out.push(`<line x1="${px(x0 + sh)}" y1="${py(y0)}" x2="${px(x1 + sh)}" y2="${py(y1)}" ${attrs}/>`);
    }
  };
  const text = (x, y, str, attrs) => out.push(`<text x="${px(x)}" y="${py(y)}" font-family="${FONT}" ${attrs}>${esc(str)}</text>`);
  const dxOf = (l) => (l % 2 ? -s.t_o : s.t_e);          // weld-side twist of a layer
  const tipY = 1.0 + 1.25;

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(W)} ${fmt(H)}" width="100%" ` +
    `style="max-width:${fmt(W)}px;display:block;background:#fff" font-family="${FONT}">`);
  out.push(`<defs><clipPath id="wclip"><rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}"/></clipPath></defs>`);
  out.push(`<rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="#fff"/>`);
  out.push(`<g clip-path="url(#wclip)">`);

  // core band
  out.push(`<rect x="${px(-0.8)}" y="${py(1)}" width="${fmt((Q + 0.6) * sx)}" height="${fmt(sy)}" fill="#e9e7e3"/>`);

  // crown pins (special: dashed and thicker)
  const ymaxPitch = Math.max(...w.pins.map((p) => p.pitch));
  for (const p of w.pins) {
    const xa = X(p.a, p.la), xb = X(p.a + p.pitch, p.lb);
    const depth = -0.35 - 2.6 * (p.pitch / ymaxPitch) - 0.08 * Math.trunc(p.la / 2);
    const xm = (xa + xb) / 2;
    const dash = p.special ? ` stroke-dasharray="${lw(4 * 1.7)} ${lw(1.5 * 1.7)}"` : "";
    const attrs = `stroke="${COL[p.phase]}" stroke-width="${lw(p.special ? 1.7 : 1.0)}" opacity="0.9"${dash}`;
    seg(xa, 0, xm, depth, attrs);
    seg(xm, depth, xb, 0, attrs);
  }

  // weld side tips and weld bars
  const termConds = new Map();
  for (const t of w.terminals) t.conds.forEach((c, i) => termConds.set(key(...c), { t, loc: t.locs[i], c }));
  const jumpConds = new Map();
  for (const j of w.jumpers) for (const c of j.conds) jumpConds.set(key(...c), { j, c });
  for (const wd of w.welds) {
    const pts = [];
    for (const [sl, l] of wd.ends) {
      const xs = X(sl, l), xt = X(sl + dxOf(l), l);
      seg(xs, 1, xt, tipY, `stroke="${COL[wd.phase]}" stroke-width="${lw(1.0)}" opacity="0.9"`);
      pts.push(mod(xt, Q));
    }
    if (Math.abs(pts[0] - pts[1]) > Q / 2) pts[1] += pts[0] > pts[1] ? Q : -Q;
    const xc = (pts[0] + pts[1]) / 2;
    for (const sh of [-Q, 0, Q]) {
      if (Math.max(...pts) + sh < xmin || Math.min(...pts) + sh > xmax) continue;
      out.push(`<line x1="${px(pts[0] + sh)}" y1="${py(tipY)}" x2="${px(pts[1] + sh)}" y2="${py(tipY)}" ` +
        `stroke="#333" stroke-width="${lw(3.2)}" stroke-linecap="round"/>`);
      if (wd.switched) {                                   // small downward triangle marker
        const cx = (xc + sh - xmin) * sx, cy = (ymax - (tipY + 0.16)) * sy, r = 0.07 * sx;
        out.push(`<polygon points="${fmt(cx - r)},${fmt(cy - r)} ${fmt(cx + r)},${fmt(cy - r)} ${fmt(cx)},${fmt(cy + r)}" fill="#111"/>`);
      }
    }
  }
  // terminal and jumper tips
  for (const { c } of [...termConds.values(), ...jumpConds.values()]) {
    const [sl, l] = c;
    const ph = belt(s, sl, l)[0];
    seg(X(sl, l), 1, X(sl + dxOf(l), l), tipY, `stroke="${COL[ph]}" stroke-width="${lw(1.0)}"`);
  }
  // jumpers: raised bars between the two switched locations
  for (const j of w.jumpers) {
    const [[s0, l0], [s1, l1]] = j.conds;
    let x0 = mod(X(s0 + dxOf(l0), l0), Q), x1 = mod(X(s1 + dxOf(l1), l1), Q);
    if (Math.abs(x1 - x0) > Q / 2) x1 += x0 > x1 ? Q : -Q;
    const yj = tipY + 0.45 + 0.22 * PHASES.indexOf(j.phase);
    for (const sh of [-Q, 0, Q]) {
      if (Math.max(x0, x1) + sh < xmin || Math.min(x0, x1) + sh > xmax) continue;
      const pts = [[x0 + sh, tipY], [x0 + sh, yj], [x1 + sh, yj], [x1 + sh, tipY]].map(([x, y]) => `${px(x)},${py(y)}`).join(" ");
      out.push(`<polyline points="${pts}" fill="none" stroke="${COL[j.phase]}" stroke-width="${lw(2.2)}" opacity="0.85"/>`);
    }
    text(mod((x0 + x1) / 2, Q), yj + 0.05, `jumper ${NAME[j.phase]}`,
      `text-anchor="middle" font-size="${fs(7)}" fill="${COL[j.phase]}"`);
  }
  // terminals: lead up to a boxed label
  for (const { t, c } of termConds.values()) {
    const [sl, l] = c;
    const xt = mod(X(sl + dxOf(l), l), Q);
    const lab = TERM[s.terminals][t.kind](NAME[t.phase]);
    out.push(`<line x1="${px(xt)}" y1="${py(tipY)}" x2="${px(xt)}" y2="${py(tipY + 1.3)}" stroke="${COL[t.phase]}" stroke-width="${lw(2.2)}"/>`);
    const f = Number(fs(9)), bw = (lab.length * 0.62 + 0.9) * f, bh = 1.5 * f;
    const cx = (xt - xmin) * sx, by = (ymax - (tipY + 1.33)) * sy - bh;
    out.push(`<rect x="${fmt(cx - bw / 2)}" y="${fmt(by)}" width="${fmt(bw)}" height="${fmt(bh)}" rx="${fmt(0.3 * f)}" ` +
      `fill="#fff" stroke="${COL[t.phase]}" stroke-width="${lw(0.8)}"/>`);
    out.push(`<text x="${fmt(cx)}" y="${fmt(by + bh / 2)}" font-family="${FONT}" font-size="${fmt(f)}" font-weight="bold" ` +
      `fill="${COL[t.phase]}" text-anchor="middle" dominant-baseline="central">${esc(lab)}</text>`);
  }

  // conductors in slots with current-direction arrows (drawn on top)
  const headL = 0.16, headW = 0.045;
  for (const ph of PHASES) {
    for (const pth of w.paths[ph]) {
      for (const [sl, l, d] of pth) {
        const x = X(sl, l);
        out.push(`<line x1="${px(x)}" y1="${py(0.04)}" x2="${px(x)}" y2="${py(0.96)}" stroke="${COL[ph]}" stroke-width="${lw(1.6)}"/>`);
        const [y0, y1] = d > 0 ? [0.62, 0.38] : [0.38, 0.62];     // +1 points toward the crown side
        const yb = y1 + (y0 > y1 ? headL : -headL);
        out.push(`<polygon points="${px(x)},${py(y1)} ${px(x - headW)},${py(yb)} ${px(x + headW)},${py(yb)}" fill="${COL[ph]}"/>`);
      }
    }
  }

  // labels: core, slot numbers (1-based), side names, legend
  text(-0.75, 0.5, "core", `font-size="${fs(8)}" fill="#777" dominant-baseline="central"`);
  for (let sl = 0; sl < Q; sl++) {
    text(sl, -0.18, String(sl + 1), `text-anchor="middle" font-size="${fs(8)}" fill="#444" dominant-baseline="hanging"`);
  }
  text(-0.75, 1.15, "WELD / CONNECTION SIDE", `font-size="${fs(8)}" fill="#555"`);
  text(-0.75, -0.55, "CROWN SIDE (hairpin heads)", `font-size="${fs(8)}" fill="#555" dominant-baseline="hanging"`);
  PHASES.forEach((ph, i) => {
    const x0 = Q - 4.2 + 1.3 * i;
    out.push(`<line x1="${px(x0)}" y1="${py(-3.5)}" x2="${px(x0 + 0.4)}" y2="${py(-3.5)}" stroke="${COL[ph]}" stroke-width="${lw(3)}"/>`);
    text(x0 + 0.5, -3.5, `${NAME[ph]} (${ph})`, `font-size="${fs(8)}" fill="#333" dominant-baseline="central"`);
  });
  text(-0.75, -3.5, `Arrows in slots: current direction for positive phase current.  Lanes in each slot: layer 1 (bore side) left → layer ${L} right.`,
    `font-size="${fs(8)}" fill="#555" dominant-baseline="central"`);

  out.push(`</g></svg>`);
  return out.join("\n");
}
