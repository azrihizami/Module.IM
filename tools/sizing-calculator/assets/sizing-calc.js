/* Motoreka — Sizing Calculator engine (public copy of the training tool).
   Pure functions, no DOM. Mirrors data/s1_solution.py. Works in the browser (window.SizingCalc) and in Node. */
(function (root) {
  "use strict";
  var g = 9.81, PI = Math.PI;

  var DEFAULTS = {
    // vehicle (example case)
    m_test: 1300, m_lad: 1600, Cd: 0.296, A: 2.23, Crr: 0.011, rho: 1.20, r_w: 0.283, lam: 1.05, eta_g: 0.97,
    // targets and constraints (example case, Training targets)
    t_0100: 9.5, t_80120: 7.0, v_max: 150, grade_hill: 30, grade_cont: 6, v_cont: 80,
    Vdc_min: 300, Vdc_max: 400, n_max: 13000, D_so_max: 220, L_max: 150, tip_limit: 100,
    // design choices (example values)
    P_pk: 80, P_cont: 40, G: 9.0, CPSR: 3.25, sigma: 50, D_r: 130, split: 0.62,
    poles: 8, Bg: 0.85, kw: 0.933, cospsi: 0.90, f_sw: 10, emf_frac: 0.75, mu: 0.9, front_share: 0.6
  };

  function roadForces(p, m, v, gradePct) {
    var a = Math.atan((gradePct || 0) / 100);
    return {
      grade: m * g * Math.sin(a),
      roll: p.Crr * m * g * Math.cos(a),
      aero: 0.5 * p.rho * p.Cd * p.A * v * v
    };
  }
  function sum(f) { return f.grade + f.roll + f.aero; }

  function motorTorqueAvail(p, T_pk, w) {
    var n = w * 60 / (2 * PI);
    if (n >= p.n_max) return 0;
    return Math.min(T_pk, p.P_pk * 1e3 / Math.max(w, 1e-6));
  }

  // time-stepped full-throttle run, returns time from v0 to v1 (km/h), or NaN if not reached in 60 s
  function accelTime(p, T_pk, v0, v1, trace) {
    var dt = 0.001, v = v0 / 3.6, t = 0, pts = trace ? [[0, v0]] : null, k = 0;
    while (v < v1 / 3.6) {
      var w = v / p.r_w * p.G;
      var Tm = motorTorqueAvail(p, T_pk, w);
      var Fw = Tm * p.G * p.eta_g / p.r_w;
      var F = roadForces(p, p.m_test, v, 0);
      var acc = (Fw - F.roll - F.aero) / (p.lam * p.m_test);
      if (acc <= 0) return trace ? { t: NaN, pts: pts } : NaN;
      v += acc * dt; t += dt; k++;
      if (trace && k % 50 === 0) pts.push([t, v * 3.6]);
      if (t > 60) return trace ? { t: NaN, pts: pts } : NaN;
    }
    if (trace) { pts.push([t, v * 3.6]); return { t: t, pts: pts }; }
    return t;
  }

  // top speed on level road at test mass: limited by power or by n_max
  function topSpeed(p, T_pk) {
    var v_n = p.n_max * 2 * PI / 60 / p.G * p.r_w;          // speed at n_max, m/s
    var lo = 1, hi = v_n;
    for (var i = 0; i < 80; i++) {
      var mid = (lo + hi) / 2, w = mid / p.r_w * p.G;
      var Fw = motorTorqueAvail(p, T_pk, Math.min(w, p.n_max * 2 * PI / 60 * 0.99999)) * p.G * p.eta_g / p.r_w;
      var F = roadForces(p, p.m_test, mid, 0);
      if (Fw > F.roll + F.aero) lo = mid; else hi = mid;
    }
    return { kmh: lo * 3.6, limitedBy: (lo > v_n * 0.995) ? "speed" : "power" };
  }

  function compute(input) {
    var p = {}, k;
    for (k in DEFAULTS) p[k] = (input && input[k] !== undefined && input[k] !== "" && !isNaN(+input[k])) ? +input[k] : DEFAULTS[k];
    var r = { p: p };

    // ---- A: vehicle to wheel
    var v150 = p.v_max / 3.6;
    var fTop = roadForces(p, p.m_test, v150, 0);
    r.P_top_kW = sum(fTop) * v150 / p.eta_g / 1e3;
    var vC = p.v_cont / 3.6;
    var fC = roadForces(p, p.m_lad, vC, p.grade_cont);
    r.F_cont = fC; r.P_climb_kW = sum(fC) * vC / p.eta_g / 1e3;
    var fH = roadForces(p, p.m_lad, 0, p.grade_hill);
    r.F_hill = fH.grade + fH.roll;
    r.Tw_hill = r.F_hill * p.r_w;
    r.P_cont_req_kW = Math.max(r.P_top_kW, r.P_climb_kW);

    // ---- B: wheel to motor
    r.G_max = (p.n_max * 2 * PI / 60) * p.r_w / v150;
    r.n_at_vmax = v150 / p.r_w * p.G * 60 / (2 * PI);
    r.n_b = p.n_max / p.CPSR;
    r.w_b = r.n_b * 2 * PI / 60;
    r.T_pk = p.P_pk * 1e3 / r.w_b;
    r.T_cont = p.P_cont * 1e3 / r.w_b;
    r.Vb_kmh = r.w_b / p.G * p.r_w * 3.6;
    r.T_hill = r.Tw_hill / (p.G * p.eta_g);
    r.T_slip = p.front_share * p.m_test * g * p.mu * p.r_w / (p.G * p.eta_g);
    r.n_cont = vC / p.r_w * p.G * 60 / (2 * PI);
    r.T_at_cont = r.P_climb_kW * 1e3 / (r.n_cont * 2 * PI / 60);
    r.T_at_top = r.P_top_kW * 1e3 / (r.n_at_vmax * 2 * PI / 60);

    // hand estimate of peak power (constant torque to V_b, constant power above)
    var Vf = 100 / 3.6, Vb = r.Vb_kmh / 3.6;
    r.P_hand_kW = (p.lam * p.m_test / (2 * p.t_0100) * (Vf * Vf + Vb * Vb) + 2 / 3 * p.m_test * g * p.Crr * Vf +
                   1 / 5 * p.rho * p.Cd * p.A * Math.pow(Vf, 3)) / p.eta_g / 1e3;

    // simulation
    var tr = accelTime(p, r.T_pk, 0, 100, true);
    r.t_0100 = tr.t;
    r.trace = accelTime(p, r.T_pk, 0, Math.min(160, p.n_max * 2 * PI / 60 / p.G * p.r_w * 3.6 - 0.5), true).pts;
    r.t_80120 = accelTime(p, r.T_pk, 80, 120, false);
    r.vtop = topSpeed(p, r.T_pk);
    r.vtop_cont = topSpeed(Object.assign({}, p, { P_pk: p.P_cont }), r.T_cont);

    // ---- C: main dimensions
    var sig = p.sigma * 1e3, Dr = p.D_r / 1000;
    r.D2L = 2 * r.T_pk / (PI * sig);
    r.L_exact = r.D2L / (Dr * Dr) * 1000;
    r.L = Math.ceil(r.L_exact / 5 - 1e-9) * 5;
    r.sigma_act = 2 * r.T_pk / (PI * Dr * Dr * r.L / 1000) / 1e3;
    r.D_so = Math.round(p.D_r / p.split / 5) * 5;
    r.aspect = r.L / p.D_r;
    r.tip = PI * Dr * p.n_max / 60;
    r.TRV = 2 * r.sigma_act;
    r.A_pk = Math.SQRT2 * r.sigma_act * 1e3 / (p.kw * p.Bg * p.cospsi) / 1e3;
    r.A_cont = r.A_pk * r.T_cont / r.T_pk;

    // ---- D: electrical checks
    var pp = p.poles / 2;
    r.f_max = pp * p.n_max / 60;
    r.sw_ratio = p.f_sw * 1e3 / r.f_max;
    r.Vph_pk = p.Vdc_min / Math.sqrt(3);
    r.E_b = p.emf_frac * r.Vph_pk;
    r.we_b = pp * r.w_b;
    r.lam_pm = r.E_b / r.we_b;
    r.tau_p = PI * Dr / p.poles;
    r.Phi_p = 2 / PI * p.Bg * r.tau_p * r.L / 1000;
    r.N_ph = r.lam_pm / (p.kw * r.Phi_p);
    r.we_max = pp * p.n_max * 2 * PI / 60;
    r.E_max_ll = r.lam_pm * r.we_max * Math.sqrt(3);

    // ---- checks
    function c(id, label, ok, detail) { return { id: id, label: label, ok: ok, detail: detail }; }
    r.checks = [
      c("T1", "0–100 km/h", r.t_0100 <= p.t_0100, fmt(r.t_0100, 2) + " s ≤ " + p.t_0100 + " s"),
      c("T2", "80–120 km/h", r.t_80120 <= p.t_80120, fmt(r.t_80120, 2) + " s ≤ " + p.t_80120 + " s"),
      c("T3", "Top speed held continuously", r.vtop_cont.kmh >= p.v_max - 0.05, fmt(r.vtop_cont.kmh, 0) + " km/h at continuous power"),
      c("T4", "Hill start " + p.grade_hill + " %", r.T_hill <= r.T_pk, fmt(r.T_hill, 0) + " ≤ " + fmt(r.T_pk, 0) + " N·m"),
      c("T5", "Sustained climb", r.P_climb_kW <= p.P_cont, fmt(r.P_climb_kW, 1) + " ≤ " + p.P_cont + " kW continuous"),
      c("C2", "Motor speed at top speed", r.n_at_vmax <= p.n_max, fmt(r.n_at_vmax, 0) + " ≤ " + fmt(p.n_max, 0) + " rpm"),
      c("C4", "Envelope", r.L <= p.L_max && r.D_so <= p.D_so_max, r.D_so + " mm OD, " + r.L + " mm long"),
      c("Tip", "Rotor surface speed", r.tip <= p.tip_limit, fmt(r.tip, 1) + " ≤ " + p.tip_limit + " m/s"),
      c("f", "Switching per electrical cycle", r.sw_ratio >= 10, fmt(r.sw_ratio, 1) + " ≥ 10"),
      c("Grip", "Not traction limited", r.T_pk <= r.T_slip, fmt(r.T_pk, 0) + " ≤ " + fmt(r.T_slip, 0) + " N·m")
    ];
    return r;
  }

  // smallest peak power (0.1 kW) meeting T1 and T2 with the current CPSR and ratio
  function minPeakPower(input) {
    var lo = 20, hi = 300;
    function ok(P) { var r = compute(Object.assign({}, input, { P_pk: P })); return r.t_0100 <= r.p.t_0100 && r.t_80120 <= r.p.t_80120; }
    if (!ok(hi)) return NaN;
    for (var i = 0; i < 30; i++) { var mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
    return Math.ceil(hi * 10) / 10;
  }

  function fmt(x, d) {
    if (x === undefined || x === null || isNaN(x)) return "—";
    return Number(x).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function designCard(r, group) {
    return {
      format: "motoreka-design-card", version: 1, case: "EXAMPLE", group: group || "", saved: new Date().toISOString(),
      s1: {
        P_pk_kW: r.p.P_pk, T_pk_Nm: +r.T_pk.toFixed(1), P_cont_kW: r.p.P_cont, T_cont_Nm: +r.T_cont.toFixed(1),
        n_base_rpm: Math.round(r.n_b), n_max_rpm: r.p.n_max, G: r.p.G, D_r_mm: r.p.D_r, L_mm: r.L, D_so_mm: r.D_so,
        sigma_kPa: +r.sigma_act.toFixed(1), poles: r.p.poles, f_max_Hz: +r.f_max.toFixed(0), lambda_pm_Wb: +r.lam_pm.toFixed(4),
        N_ph: +r.N_ph.toFixed(1), t_0100_s: +r.t_0100.toFixed(2), t_80120_s: +r.t_80120.toFixed(2),
        E_max_ll_V: +r.E_max_ll.toFixed(0), Vdc_min_V: r.p.Vdc_min
      },
      s1_inputs: r.p, s2: null, s3: null, s4: null, s5: null
    };
  }

  var api = { DEFAULTS: DEFAULTS, compute: compute, minPeakPower: minPeakPower, designCard: designCard, fmt: fmt };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SizingCalc = api;
})(typeof window !== "undefined" ? window : this);
