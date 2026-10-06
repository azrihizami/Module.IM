/* Motoreka Training — Sizing Calculator UI. Needs sizing-calc.js loaded first. */
(function () {
  "use strict";
  var S = window.SizingCalc, fmt = S.fmt, KEY = "motoreka-public-sizing-inputs", GKEY = "motoreka-public-sizing-name";
  var form = document.getElementById("calc-form");
  if (!form) return;
  var inputs = form.querySelectorAll("input[data-k]");

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function read() {
    var o = {};
    inputs.forEach(function (el) { o[el.dataset.k] = el.value; });
    return o;
  }
  function write(o) {
    inputs.forEach(function (el) { if (o[el.dataset.k] !== undefined) el.value = o[el.dataset.k]; });
  }
  function resetDefaults() { write(S.DEFAULTS); }

  // ---------- tiny SVG chart
  var NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceTicks(lo, hi, n) {
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / n)));
    var err = n / span * step;
    if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
    var t = [], v = Math.ceil(lo / step) * step;
    for (; v <= hi + 1e-9; v += step) t.push(+v.toFixed(10));
    return t;
  }
  function chart(host, o) {
    host.innerHTML = "";
    var W = 640, H = 330, m = { l: 58, r: 18, t: 16, b: 46 };
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": o.aria, class: "chart" }, host);
    var X = function (x) { return m.l + (x - o.x0) / (o.x1 - o.x0) * (W - m.l - m.r); };
    var Y = function (y) { return H - m.b - (y - o.y0) / (o.y1 - o.y0) * (H - m.t - m.b); };
    niceTicks(o.x0, o.x1, 6).forEach(function (t) {
      el("line", { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b, class: "grid" }, svg);
      var tx = el("text", { x: X(t), y: H - m.b + 18, class: "tick", "text-anchor": "middle" }, svg); tx.textContent = fmt(t, 0);
    });
    niceTicks(o.y0, o.y1, 5).forEach(function (t) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: "grid" }, svg);
      var ty = el("text", { x: m.l - 8, y: Y(t) + 4, class: "tick", "text-anchor": "end" }, svg); ty.textContent = fmt(t, 0);
    });
    el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "axis" }, svg);
    el("line", { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, class: "axis" }, svg);
    var xl = el("text", { x: (m.l + W - m.r) / 2, y: H - 8, class: "axlabel", "text-anchor": "middle" }, svg); xl.textContent = o.xlabel;
    var yl = el("text", { x: 14, y: m.t + 2, class: "axlabel", "text-anchor": "start" }, svg); yl.textContent = o.ylabel;
    (o.vlines || []).forEach(function (v) {
      if (v.x < o.x0 || v.x > o.x1) return;
      el("line", { x1: X(v.x), x2: X(v.x), y1: m.t, y2: H - m.b, class: "ref" }, svg);
      var t = el("text", { x: X(v.x) + (v.left ? -5 : 5), y: m.t + 12, class: "reflabel", "text-anchor": v.left ? "end" : "start" }, svg); t.textContent = v.label;
    });
    (o.hlines || []).forEach(function (h) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(h.y), y2: Y(h.y), class: "ref" }, svg);
      var t = el("text", { x: W - m.r - 4, y: Y(h.y) - 5, class: "reflabel", "text-anchor": "end" }, svg); t.textContent = h.label;
    });
    (o.series || []).forEach(function (s) {
      var d = s.pts.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(Math.min(p[1], o.y1 * 1.02)).toFixed(1); }).join(" ");
      if (s.fill) el("path", { d: d + " L" + X(s.pts[s.pts.length - 1][0]).toFixed(1) + " " + Y(o.y0) + " L" + X(s.pts[0][0]).toFixed(1) + " " + Y(o.y0) + " Z", class: s.cls + "-fill" }, svg);
      el("path", { d: d, class: s.cls, fill: "none" }, svg);
      if (s.label) { var t = el("text", { x: X(s.lx), y: Y(s.ly), class: s.cls + "-label" }, svg); t.textContent = s.label; }
    });
    (o.points || []).forEach(function (p) {
      if (p.x > o.x1 || p.y > o.y1) return;
      el("circle", { cx: X(p.x), cy: Y(p.y), r: p.hi ? 5.5 : 4.5, class: p.hi ? "pt-hi" : (p.ok === false ? "pt-bad" : "pt") }, svg);
      if (p.label) {
        var t = el("text", { x: X(p.x) + (p.dx || 8), y: Y(p.y) + (p.dy || -8), class: "ptlabel", "text-anchor": p.anchor || "start" }, svg);
        t.textContent = p.label;
      }
    });
  }

  // ---------- render
  function setText(id, s) { var e = document.getElementById(id); if (e) e.textContent = s; }
  function rows(id, list) {
    var tb = document.getElementById(id); if (!tb) return;
    tb.innerHTML = list.map(function (r) {
      return "<tr><td>" + r[0] + "</td><td class=\"num\">" + r[1] + "</td><td>" + (r[2] || "") + "</td></tr>";
    }).join("");
  }

  var last = null;
  function run() {
    var inp = read();
    var r = S.compute(inp); last = r;
    store(KEY, JSON.stringify(inp));
    var p = r.p;

    // checks
    var ch = document.getElementById("checks");
    ch.innerHTML = r.checks.map(function (c) {
      return '<li class="' + (c.ok ? "ok" : "bad") + '"><span class="ck-id">' + c.id + '</span><span class="ck-l">' + c.label +
        '</span><span class="ck-d">' + c.detail + '</span><span class="ck-s">' + (c.ok ? "Pass" : "Fail") + "</span></li>";
    }).join("");
    var nFail = r.checks.filter(function (c) { return !c.ok; }).length;
    setText("check-sum", nFail ? nFail + " of " + r.checks.length + " checks fail" : "All " + r.checks.length + " checks pass");
    document.getElementById("check-sum").className = "chip " + (nFail ? "bad" : "ok");

    // nameplate
    var plate = {
      "pl-ppk": fmt(p.P_pk, 0) + " kW", "pl-tpk": fmt(r.T_pk, 0) + " N·m", "pl-pc": fmt(p.P_cont, 0) + " kW",
      "pl-tc": fmt(r.T_cont, 1) + " N·m", "pl-nb": fmt(r.n_b, 0) + " rpm", "pl-nmax": fmt(p.n_max, 0) + " rpm",
      "pl-g": fmt(p.G, 2) + " : 1", "pl-dl": fmt(p.D_r, 0) + " × " + fmt(r.L, 0) + " mm", "pl-dso": fmt(r.D_so, 0) + " mm",
      "pl-sig": fmt(r.sigma_act, 1) + " kPa", "pl-poles": fmt(p.poles, 0), "pl-f": fmt(r.f_max, 0) + " Hz"
    };
    for (var k in plate) setText(k, plate[k]);

    // torque-speed chart
    var env = function (T, P) {
      var pts = [], n;
      for (n = 0; n <= p.n_max; n += p.n_max / 120) {
        var w = n * 2 * Math.PI / 60;
        pts.push([n, n <= r.n_b ? T : P * 1e3 / w]);
      }
      return pts;
    };
    var ymax = Math.max(r.T_pk, r.T_hill) * 1.2;
    chart(document.getElementById("chart-ts"), {
      aria: "Motor torque against speed: peak and continuous envelopes with the duty points",
      x0: 0, x1: p.n_max * 1.05, y0: 0, y1: ymax, xlabel: "Motor speed (rpm)", ylabel: "Torque (N·m)",
      series: [
        { pts: env(r.T_cont, p.P_cont), cls: "s-cont", fill: true, label: "Continuous", lx: p.n_max * 0.02, ly: r.T_cont + ymax * 0.03 },
        { pts: env(r.T_pk, p.P_pk), cls: "s-peak", label: "Peak", lx: r.n_b * 1.05, ly: r.T_pk * 0.97 }
      ],
      vlines: [{ x: r.n_b, label: "Base " + fmt(r.n_b, 0) + " rpm" }, { x: p.n_max, label: "n max", left: true }],
      points: [
        { x: p.n_max * 0.02, y: r.T_hill, label: "T4 hill start", ok: r.T_hill <= r.T_pk, dx: 8, dy: -8 },
        { x: r.n_cont, y: r.T_at_cont, label: "T5 climb", ok: r.P_climb_kW <= p.P_cont, dx: -8, dy: 18, anchor: "end" },
        { x: r.n_at_vmax, y: r.T_at_top, label: "T3 top speed", ok: r.n_at_vmax <= p.n_max, dx: -8, dy: 18, anchor: "end" },
        { x: r.n_b, y: r.T_pk, hi: true }
      ]
    });

    // acceleration chart
    var tr = r.trace, tEnd = Math.max(20, Math.ceil((tr.length ? tr[tr.length - 1][0] : 20) / 5) * 5);
    chart(document.getElementById("chart-acc"), {
      aria: "Vehicle speed against time for a full-throttle start",
      x0: 0, x1: Math.min(tEnd, 40), y0: 0, y1: 170, xlabel: "Time (s)", ylabel: "Speed (km/h)",
      series: [{ pts: tr, cls: "s-peak" }],
      hlines: [{ y: 100, label: "100 km/h" }],
      vlines: [{ x: p.t_0100, label: "T1 " + p.t_0100 + " s" }],
      points: isNaN(r.t_0100) ? [] : [{ x: r.t_0100, y: 100, hi: true, label: fmt(r.t_0100, 2) + " s", dx: -8, dy: -10, anchor: "end" }]
    });

    // tables
    rows("tb-a", [
      ["T3 · power at " + p.v_max + " km/h, level, test mass", fmt(r.P_top_kW, 1) + " kW", "At the motor shaft"],
      ["T5 · force on " + p.grade_cont + " % at " + p.v_cont + " km/h, laden", fmt(r.F_cont.grade + r.F_cont.roll + r.F_cont.aero, 0) + " N",
        "Grade " + fmt(r.F_cont.grade, 0) + ", rolling " + fmt(r.F_cont.roll, 0) + ", aero " + fmt(r.F_cont.aero, 0)],
      ["T5 · power for the sustained climb", fmt(r.P_climb_kW, 1) + " kW", "At the motor shaft"],
      ["Continuous power required", fmt(r.P_cont_req_kW, 1) + " kW", "Larger of T3 and T5; you set " + p.P_cont + " kW"],
      ["T4 · wheel torque for " + p.grade_hill + " % hill start", fmt(r.Tw_hill, 0) + " N·m", "Laden mass"],
      ["T1 · hand estimate of peak power", fmt(r.P_hand_kW, 1) + " kW", "Formula with V_b = " + fmt(r.Vb_kmh, 1) + " km/h"]
    ]);
    rows("tb-b", [
      ["Largest ratio for C2", fmt(r.G_max, 2), "n_max at " + p.v_max + " km/h"],
      ["Motor speed at " + p.v_max + " km/h", fmt(r.n_at_vmax, 0) + " rpm", "With G = " + p.G],
      ["Base speed", fmt(r.n_b, 0) + " rpm", "n_max / CPSR"],
      ["Peak torque", fmt(r.T_pk, 1) + " N·m", "P_pk / ω_b"],
      ["Continuous torque", fmt(r.T_cont, 1) + " N·m", "P_cont / ω_b"],
      ["Hill-start motor torque", fmt(r.T_hill, 1) + " N·m", "Must not exceed peak torque"],
      ["Motor torque at wheel slip", fmt(r.T_slip, 0) + " N·m", "μ = " + p.mu + ", " + fmt(p.front_share * 100, 0) + " % on the front axle"],
      ["0–100 km/h (simulated)", fmt(r.t_0100, 2) + " s", "Target " + p.t_0100 + " s"],
      ["80–120 km/h (simulated)", fmt(r.t_80120, 2) + " s", "Target " + p.t_80120 + " s"],
      ["Top speed", fmt(r.vtop.kmh, 0) + " km/h", "Limited by " + (r.vtop.limitedBy === "speed" ? "maximum motor speed" : "power")]
    ]);
    rows("tb-c", [
      ["Rotor volume D²L", fmt(r.D2L * 1e6, 0) + " cm³", "2T / (π σ)"],
      ["Stack length", fmt(r.L, 0) + " mm", "Exact " + fmt(r.L_exact, 1) + " mm, rounded up to 5 mm"],
      ["Shear stress achieved", fmt(r.sigma_act, 1) + " kPa", "TRV " + fmt(r.TRV, 0) + " kN·m/m³"],
      ["Stator outer diameter", fmt(r.D_so, 0) + " mm", "D_r / split ratio"],
      ["Aspect ratio L / D_r", fmt(r.aspect, 2), "Typical 0.6 to 1.3"],
      ["Rotor surface speed at n_max", fmt(r.tip, 1) + " m/s", "Limit " + p.tip_limit + " m/s for this course"],
      ["Electric loading at peak", fmt(r.A_pk, 0) + " kA/m", "RMS; continuous " + fmt(r.A_cont, 0) + " kA/m"]
    ]);
    rows("tb-d", [
      ["Maximum electrical frequency", fmt(r.f_max, 0) + " Hz", p.poles + " poles at " + fmt(p.n_max, 0) + " rpm"],
      ["Switching periods per cycle", fmt(r.sw_ratio, 1), "At " + p.f_sw + " kHz"],
      ["Peak phase voltage available", fmt(r.Vph_pk, 0) + " V", "V_dc,min / √3"],
      ["Magnet flux linkage target", fmt(r.lam_pm * 1000, 1) + " mWb", "Back-EMF at base = " + fmt(p.emf_frac * 100, 0) + " % of available"],
      ["Series turns per phase (first estimate)", fmt(r.N_ph, 1), "Pole flux " + fmt(r.Phi_p * 1000, 2) + " mWb"],
      ["Line back-EMF at n_max (peak)", fmt(r.E_max_ll, 0) + " V", r.E_max_ll > p.Vdc_max ? "Above V_dc,max " + p.Vdc_max + " V: check the inverter fault case" : "Below V_dc,max"]
    ]);
    var ta = document.getElementById("card-json");
    if (ta && ta.dataset.dirty !== "1") ta.value = JSON.stringify(S.designCard(r, groupName()), null, 1);
  }

  function groupName() { var g = document.getElementById("group"); return g ? g.value.trim() : ""; }

  // ---------- events
  var tmr;
  form.addEventListener("input", function () { clearTimeout(tmr); tmr = setTimeout(run, 120); });
  form.addEventListener("submit", function (e) { e.preventDefault(); run(); });
  document.getElementById("btn-reset").addEventListener("click", function () { resetDefaults(); run(); });
  document.getElementById("btn-minp").addEventListener("click", function () {
    var P = S.minPeakPower(read()), msg = document.getElementById("minp-msg");
    if (isNaN(P)) { msg.textContent = "No power up to 300 kW meets T1 and T2 with this ratio and CPSR."; return; }
    msg.textContent = "Minimum peak power for T1 and T2: " + fmt(P, 1) + " kW. Round up to set your design value.";
  });
  var grp = document.getElementById("group");
  var gSaved = recall(GKEY); if (gSaved) grp.value = gSaved;
  grp.addEventListener("input", function () { store(GKEY, grp.value); run(); });

  document.getElementById("btn-save").addEventListener("click", function () {
    if (!last) return;
    var card = S.designCard(last, groupName()), txt = JSON.stringify(card, null, 1);
    document.getElementById("card-json").value = txt;
    try {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([txt], { type: "application/json" }));
      a.download = "Motoreka_design-card" + (card.group ? "_" + card.group.replace(/[^A-Za-z0-9-]+/g, "-") : "") + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      note("Design card saved. If no file appeared, copy the text below instead.");
    } catch (e) { note("Download is not available here. Copy the text below instead."); }
  });
  document.getElementById("btn-copy").addEventListener("click", function () {
    var ta = document.getElementById("card-json");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(function () { note("Copied."); }, function () { ta.select(); note("Press Ctrl+C to copy."); });
    } else { ta.select(); note("Press Ctrl+C to copy."); }
  });
  function loadCard(txt) {
    try {
      var c = JSON.parse(txt);
      if (c.format !== "motoreka-design-card" || !c.s1_inputs) throw new Error("not a card");
      write(c.s1_inputs); if (c.group) { grp.value = c.group; store(GKEY, c.group); }
      document.getElementById("card-json").dataset.dirty = "0";
      run(); note("Design card loaded" + (c.group ? " for " + c.group : "") + ".");
    } catch (e) { note("That file is not a Motoreka design card. Check that you chose the .json file saved by a Motoreka tool."); }
  }
  document.getElementById("file-card").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    var rd = new FileReader(); rd.onload = function () { loadCard(rd.result); }; rd.readAsText(f); e.target.value = "";
  });
  document.getElementById("btn-loadtext").addEventListener("click", function () { loadCard(document.getElementById("card-json").value); });
  document.getElementById("card-json").addEventListener("input", function () { this.dataset.dirty = "1"; });
  function note(s) { var n = document.getElementById("card-msg"); n.textContent = s; }

  // ---------- start
  var saved = recall(KEY);
  if (saved) { try { write(JSON.parse(saved)); } catch (e) { resetDefaults(); } } else resetDefaults();
  run();
})();
