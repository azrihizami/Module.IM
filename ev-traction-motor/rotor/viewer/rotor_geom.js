// Parametric single-V interior-magnet rotor: 2D section of one pole and the checks on it.
// Pure geometry, no rendering: the viewer extrudes what this returns. Units: mm, degrees in, radians inside.
// Pole frame: d-axis along +x, pole spans -pi/p .. +pi/p. Upper magnet (y > 0) is mirrored to y < 0.

export const PRESETS = {
  ev: {
    id: 'ev', label: 'EV rotor · 8 poles', material: 'ndfeb',
    R: 66.25, rs: 20, p: 8, alpha: 122, wm: 17, tm: 4.5, ra: 50, rib: 1.6, bo: 1.2, web: 2.0, clr: 0.2,
    L: 120, slots: 48, skewSteps: 3, skewTotal: 5.0, piecesPerStep: 2, airgap: 0.75,
    note: 'Sized to the 48-slot, 8-pole hairpin stator: bore Ø134 mm, 120 mm stack.'
  },
  kit: {
    id: 'kit', label: 'Kit rotor · 4 poles · ferrite', material: 'ferrite',
    R: 57.75, rs: 10, p: 4, alpha: 122, wm: 30, tm: 8, ra: 24, rib: 3.0, bo: 2.5, web: 4.0, clr: 0.3,
    L: 50, slots: 24, skewSteps: 1, skewTotal: 0, piecesPerStep: 2, airgap: 1.5,
    note: 'Fits the Hairpin Stator Kit: bore Ø118.5 mm, 50 mm stack. Printed core, ferrite blocks.'
  }
};

export const MATERIALS = {
  // density g/cm3; Br at 20 °C in T; alpha(Br) in %/K. Typical values, see the article's sources.
  ndfeb:   { name: 'Sintered NdFeB (SH grade)', rho: 7.5, Br: 1.25, aBr: -0.11, Tmax: 150, reFrac: 0.30 },
  ferrite: { name: 'Hard ferrite (C8)',         rho: 4.9, Br: 0.39, aBr: -0.20, Tmax: 250, reFrac: 0 }
};

const D2R = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = a => Math.hypot(a[0], a[1]);

// distance from point q to segment ab
function segDist(q, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1]], aq = [q[0] - a[0], q[1] - a[1]];
  const t = Math.max(0, Math.min(1, dot(aq, ab) / Math.max(1e-12, dot(ab, ab))));
  return len([aq[0] - ab[0] * t, aq[1] - ab[1] * t]);
}
function polyDist(q, P) { let d = Infinity; for (let i = 0; i < P.length; i++) d = Math.min(d, segDist(q, P[i], P[(i + 1) % P.length])); return d; }
function inPoly(q, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
// smallest s >= 0 with |Q + s u| = r, or NaN
function rayCircle(Q, u, r) {
  const b = dot(Q, u), c = dot(Q, Q) - r * r, disc = b * b - c;
  if (disc < 0) return NaN;
  const s = -b + Math.sqrt(disc);
  return s >= 0 ? s : NaN;
}
function area(P) { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }

/** Build one pole. Returns {upper:{magnet, pocket}, lower:{...}, hole, checks[], ok, summary{}} */
export function buildPole(P) {
  const phi = (180 - P.alpha) / 2 * D2R;          // tilt of each magnet from the tangential direction
  const u = [Math.sin(phi), Math.cos(phi)];        // along the upper magnet, away from the rib
  const n = [Math.cos(phi), -Math.sin(phi)];       // magnet normal, towards the air gap (d-axis side)
  const c = P.clr, half = Math.PI / P.p;
  // Place the inner (rib-side) end so the pocket keeps rib/2 from the d-axis.
  const Sy = P.rib / 2 + P.tm * Math.sin(phi) + c * Math.cos(phi) + c * Math.sin(phi);
  const S = [P.ra, Sy];
  const M0 = S, M1 = add(S, mul(u, P.wm)), M2 = add(M1, mul(n, P.tm)), M3 = add(S, mul(n, P.tm));
  const magnet = [M0, M1, M2, M3];
  const P0 = add(add(M0, mul(u, -c)), mul(n, -c)), P3 = add(add(M3, mul(u, -c)), mul(n, c));
  const Q1 = add(add(M1, mul(u, c)), mul(n, -c)), Q2 = add(add(M2, mul(u, c)), mul(n, c));
  const Rb = P.R - P.bo;
  const s1 = rayCircle(Q1, u, Rb), s2 = rayCircle(Q2, u, Rb);
  const checks = [];
  let pocket = null, reach = true;
  if (!(s1 >= 0) || !(s2 >= 0) || len(Q1) > Rb || len(Q2) > Rb) {
    reach = false;
    checks.push({ ok: false, k: 'fit', t: 'Magnet runs into the outer bridge: shorten it, pull it in, or close the V.' });
    pocket = [P0, Q1, Q2, P3];
  } else {
    const E1 = add(Q1, mul(u, s1)), E2 = add(Q2, mul(u, s2));
    const a1 = Math.atan2(E1[1], E1[0]), a2 = Math.atan2(E2[1], E2[0]);
    const arc = []; const N = Math.max(3, Math.ceil(Math.abs(a1 - a2) / (1.5 * D2R)));
    for (let i = 1; i < N; i++) { const a = a1 + (a2 - a1) * i / N; arc.push([Rb * Math.cos(a), Rb * Math.sin(a)]); }
    pocket = [P0, E1, ...arc, E2, P3];
  }
  if (area(pocket) < 0) pocket.reverse();
  const mag = area(magnet) < 0 ? magnet.slice().reverse() : magnet;
  const mirror = poly => poly.map(([x, y]) => [x, -y]).reverse();
  const upper = { magnet: mag, pocket }, lower = { magnet: mirror(mag), pocket: mirror(pocket) };

  // q-axis web: distance from the pocket to the line at angle pi/p (the neighbour pole's pocket is its mirror)
  const qn = [-Math.sin(half), Math.cos(half)];
  const qWeb = 2 * Math.min(...pocket.map(q => -dot(q, qn)));
  if (qWeb < P.web) checks.push({ ok: false, k: 'web', t: `q-axis web ${qWeb.toFixed(2)} mm is under ${P.web} mm: the V is too wide for this pole count.` });
  const rMin = Math.min(...pocket.map(len));
  const yoke = rMin - P.rs;
  if (yoke < 6) checks.push({ ok: false, k: 'yoke', t: `Only ${yoke.toFixed(1)} mm of steel between pocket and shaft: move the V out or use a smaller shaft.` });
  // the two pockets of one V must not overlap (rib) and the magnet must lie inside its pocket
  if (!magnet.every(q => inPoly(q, pocket) || polyDist(q, pocket) < c * 1.01)) checks.push({ ok: false, k: 'pocket', t: 'Magnet outside its pocket.' });

  // lightening hole on the q-axis: biggest circle with 3 mm to the pockets, 4 mm to the shaft, 6 mm to the OD
  let hole = null;
  const qa = [Math.cos(half), Math.sin(half)];
  const pockets4 = [pocket, mirror(pocket), pocket.map(([x, y]) => { // neighbour's lower pocket = reflection of upper about q-line
    const d = dot([x, y], qn); return [x - 2 * d * qn[0], y - 2 * d * qn[1]]; })];
  for (let rc = P.rs + 4; rc < P.R - 6; rc += 0.25) {
    const ctr = mul(qa, rc);
    const dp = Math.min(...pockets4.map(pp => inPoly(ctr, pp) ? 0 : polyDist(ctr, pp)));
    const r = Math.min(rc - P.rs - 4, dp - 3, P.R - rc - 6);
    if (r > (hole ? hole.r : 0)) hole = { c: ctr, r, rc };
  }
  if (hole && hole.r < 2.5) hole = null;
  if (hole) hole.r = Math.min(hole.r, 0.13 * P.R);

  // summary per rotor
  const mArea = Math.abs(area(magnet));                     // mm2 per magnet section
  const nMag = 2 * P.p;
  const vol = mArea * nMag * P.L / 1000;                    // cm3 for the whole rotor
  const mat = MATERIALS[P.material];
  const massMag = vol * mat.rho;                            // g
  const poleArc = 2 * Math.atan2(Math.max(...pocket.map(q => q[1])), P.R) / (2 * half);
  const steelAreaFrac = 1 - (2 * Math.abs(area(pocket)) + (hole ? Math.PI * hole.r * hole.r : 0)) / (Math.PI * (P.R * P.R - P.rs * P.rs) / P.p);
  const coreMass = Math.PI * (P.R * P.R - P.rs * P.rs) * steelAreaFrac * P.L / 1000 * (P.material === 'ferrite' ? 1.24 : 7.65);
  const summary = {
    magnets: nMag, magnetSection: `${P.wm.toFixed(1)} × ${P.tm.toFixed(1)} mm`, pieces: nMag * P.skewSteps * P.piecesPerStep,
    pieceLength: P.L / (P.skewSteps * P.piecesPerStep), magVol: vol, magMass: massMag,
    reMass: massMag * mat.reFrac, qWeb, yoke, rMin, poleArcFrac: poleArc, coreMass,
    hole: hole ? 2 * hole.r : 0, skewStep: P.skewSteps > 1 ? P.skewTotal / (P.skewSteps - 1) : 0
  };
  const ok = reach && checks.every(c => c.ok);
  if (ok) checks.push({ ok: true, k: 'ok', t: 'Section checks pass: bridge, rib, q-axis web and steel above the shaft.' });
  return { upper, lower, hole, checks, ok, summary, phi, half };
}

/** Rotate a polygon by angle a (radians). */
export function rot(poly, a) { const c = Math.cos(a), s = Math.sin(a); return poly.map(([x, y]) => [c * x - s * y, s * x + c * y]); }

/** Shaft outline with a keyway (2D), radius rs. */
export function shaftOutline(rs, keyW, keyD, N = 96) {
  const pts = [], hw = Math.asin(Math.min(0.99, keyW / 2 / rs));
  for (let i = 0; i <= N; i++) {
    const a = hw + (2 * Math.PI - 2 * hw) * i / N; pts.push([rs * Math.cos(a), rs * Math.sin(a)]);
  }
  pts.push([rs - keyD, -keyW / 2], [rs - keyD, keyW / 2]);
  return pts;
}
