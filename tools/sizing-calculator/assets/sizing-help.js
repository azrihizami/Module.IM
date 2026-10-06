/* Motoreka — Sizing Calculator help (public copy).
   Adds a "?" button to every input. Each opens a short note: what the box is, what it changes,
   and its starting value in the example case. Needs sizing-calc.js loaded first (for the default values).
   Status chips follow the course labels: tgt = Training target, inf = Inferred. */
(function () {
  "use strict";
  var S = window.SizingCalc, form = document.getElementById("calc-form");
  if (!S || !form) return;

  // k: input key (data-k). what: meaning. effect: what changes downstream. src: where the value comes from.
  // st: "tgt" Training target, "inf" Inferred, "" none (design choice or course value).
  var H = {
    P_pk: { what: "The most shaft power the motor can deliver for a short time, about 30 s from a hot start (target T6).",
      effect: "With the base speed it sets peak torque (Tpk = Ppk / ωb). It drives the 0–100 and 80–120 km/h times and the top-speed check. Use “Find minimum peak power” to see the smallest value that meets T1 and T2.",
      src: "Example value (design choice)", st: "" },
    P_cont: { what: "The power the motor can hold without overheating, for example on the 6 % climb (T5) or at top speed (T3).",
      effect: "Sets continuous torque (Tcont = Pcont / ωb) and the continuous region on the torque–speed chart. The climb and top-speed checks need it high enough.",
      src: "Example value (design choice)", st: "" },
    G: { what: "How many times the gearbox slows the motor down. 9 : 1 means the motor turns nine times for each wheel turn.",
      effect: "A higher ratio lowers the torque the motor must make, so the rotor shrinks. The price is speed: frequency, iron loss and rotor stress rise. The largest usable ratio is limited by maximum motor speed at top speed.",
      src: "Example value (design choice). The 2012 Nissan Leaf uses 8.19 : 1 (Confirmed).", st: "" },
    CPSR: { what: "Constant-power speed ratio: how far above base speed the motor can hold full power by field weakening. CPSR = maximum speed ÷ base speed.",
      effect: "Fixes the base speed and so the peak torque. A higher CPSR gives a lower base speed and a higher peak torque, but needs more field weakening from the motor.",
      src: "Example value (design choice). Interior PM motors commonly reach 3 to 4.", st: "" },
    sigma: { what: "Air-gap shear stress: the tangential force the rotor surface carries per unit area. It is the main first-pass sizing number.",
      effect: "Together with the torque it sets rotor volume (T = (π/2) σ Dr² L), so it sets the stack length. A higher value means a smaller motor that needs better cooling.",
      src: "Example value (design choice). EV traction, water jacket, peak rating: 40–75 kPa.", st: "inf" },
    D_r: { what: "Outer diameter of the rotor, in millimetres.",
      effect: "With σ and the torque it fixes the stack length. It also sets rotor surface speed (checked against the limit) and, with the split ratio, the stator outer diameter.",
      src: "Example value (design choice). The Leaf EM61 rotor is 130 mm (Confirmed).", st: "" },
    split: { what: "Rotor diameter divided by stator outer diameter. It leaves room for the slots and the stator yoke.",
      effect: "A lower ratio gives a larger stator for the same rotor, which the packaging limit may not allow. More poles allow a thinner yoke and a higher ratio.",
      src: "Example value (design choice). Typical range 0.55 to 0.70.", st: "" },
    poles: { what: "Number of magnetic poles of the rotor (not pole pairs). It must be even.",
      effect: "Sets the electrical frequency (f = poles/2 × rpm / 60). More poles thin the yoke and shorten the end windings, but raise frequency and iron loss.",
      src: "Example value (design choice). The 2012 Nissan Leaf EM61 has 8 poles (Confirmed).", st: "" },
    Bg: { what: "Peak flux density in the air gap, in tesla. It is the magnetic loading.",
      effect: "Used with the winding factor and cos ψ to turn shear stress into electric loading. The limit is tooth saturation and iron loss.",
      src: "Example value (design choice). Typical range 0.7–1.0 T (EMDLab guidance, first-pass sizing only).", st: "" },
    kw: { what: "Winding factor: how well the coil layout uses the flux (1 would be perfect).",
      effect: "Used with the flux density to turn shear stress into electric loading and, later, to estimate turns per phase.",
      src: "Example value (design choice).", st: "" },
    cospsi: { what: "cos ψ: how much of the stator current produces torque, where ψ is the angle between the current and the back-EMF.",
      effect: "A lower value means more current for the same torque. It is used in the electric-loading estimate.",
      src: "Example value (design choice).", st: "" },
    f_sw: { what: "How fast the inverter switches, in kilohertz.",
      effect: "Divided by the maximum electrical frequency it gives switching periods per electrical cycle. Aim for at least 10 so the current can be controlled well.",
      src: "Example value (design choice).", st: "" },
    emf_frac: { what: "The share of the available phase voltage that the back-EMF uses at base speed. The rest covers resistance and inductance drops.",
      effect: "Sets the magnet flux linkage and, with the pole flux, the turns per phase. Higher means fewer turns but less voltage left for the current.",
      src: "Example value (design choice).", st: "" },

    m_test: { what: "Vehicle mass for performance runs: kerb mass plus a 75 kg driver.",
      effect: "Used for acceleration and top speed. A heavier car takes longer to accelerate.",
      src: "Example case", st: "inf" },
    m_lad: { what: "Vehicle mass for gradeability: kerb mass plus five occupants and luggage.",
      effect: "Used for the hill start (T4) and the sustained climb (T5). It sets the peak torque the motor must provide at the wheels.",
      src: "Example case", st: "inf" },
    Cd: { what: "Drag coefficient: how easily air flows around the body.",
      effect: "Aerodynamic force grows with its value and with speed squared, so it mostly decides top-speed power.",
      src: "Example case. A wind-tunnel study of an earlier model of the same class gave about 0.35: try both.", st: "inf" },
    A: { what: "Frontal area of the car, in square metres.",
      effect: "Aerodynamic force grows in proportion to it, so it acts together with the drag coefficient.",
      src: "Example case", st: "inf" },
    Crr: { what: "Rolling-resistance coefficient: the share of the car’s weight that the tyres turn into drag.",
      effect: "Adds a force that does not depend on speed. It matters most on climbs and at low speed.",
      src: "Example case", st: "inf" },
    rho: { what: "Air density, in kilograms per cubic metre.",
      effect: "Scales aerodynamic force. Hot air is thinner, so the value here is for a Malaysian hot day.",
      src: "Example case", st: "inf" },
    r_w: { what: "Tyre rolling radius: the distance from the wheel centre to the road under load, in metres.",
      effect: "Converts wheel speed to vehicle speed, and torque to force. It changes the ratio needed for the top speed.",
      src: "Example case", st: "inf" },
    lam: { what: "Rotating mass factor: a small allowance for the energy needed to spin the motor, gears and wheels as well as move the car.",
      effect: "Multiplies the mass in the acceleration equation, so a larger value makes the car slower to accelerate.",
      src: "Example case", st: "inf" },
    eta_g: { what: "Gear efficiency: the share of motor power that reaches the wheels through the reduction gear.",
      effect: "Higher efficiency means the motor needs less torque and power for the same force at the wheels.",
      src: "Example case", st: "tgt" },
    mu: { what: "Friction between the tyres and the road. It limits how much torque the front tyres can pass to the road before they slip.",
      effect: "Used in the wheel-slip check, with the share of mass on the front axle. There is no value in having more motor torque than the tyres can use.",
      src: "Example value", st: "" },
    front_share: { what: "The share of the car’s weight carried by the front axle. The motor drives the front wheels.",
      effect: "Used in the wheel-slip check together with the friction value.",
      src: "Example value", st: "" },

    t_0100: { what: "Target time to accelerate from 0 to 100 km/h, in seconds, at test mass.",
      effect: "One of the checks. It mostly depends on peak power, the ratio and the vehicle mass.",
      src: "Example case, target T1 (limit, not more than)", st: "tgt" },
    t_80120: { what: "Target time to accelerate from 80 to 120 km/h, for overtaking, in seconds.",
      effect: "One of the checks. It tests peak power at higher speed, where the motor is in the constant-power region.",
      src: "Example case, target T2 (limit, not more than)", st: "tgt" },
    v_max: { what: "Top speed the car must hold on level road at test mass.",
      effect: "Sets the continuous power needed at high speed and the maximum motor speed needed for the chosen ratio.",
      src: "Example case, target T3 (at least)", st: "tgt" },
    grade_hill: { what: "Steepest slope the car must start on from standstill, in percent, at laden mass.",
      effect: "Sets the peak torque needed at the wheels, and so a lower limit on the motor peak torque.",
      src: "Example case, target T4", st: "tgt" },
    grade_cont: { what: "Slope of the sustained climb, in percent, at laden mass.",
      effect: "With the climb speed it sets the continuous power needed (target T5).",
      src: "Example case, target T5", st: "tgt" },
    v_cont: { what: "Speed held on the sustained climb, in km/h.",
      effect: "With the climb grade it sets the continuous power needed (target T5).",
      src: "Example case, target T5", st: "tgt" },
    Vdc_min: { what: "Lowest battery (DC bus) voltage, for example when the battery is nearly empty.",
      effect: "Sets the phase voltage the inverter can apply, so the motor is sized to give full torque at this voltage.",
      src: "Example case, constraint C1", st: "tgt" },
    Vdc_max: { what: "Highest battery (DC bus) voltage, for example when fully charged.",
      effect: "This calculator does not use it in a check. It is kept because the back-EMF at maximum speed is compared with the bus voltage when the inverter fault case is checked.",
      src: "Example case, constraint C1", st: "tgt" },
    n_max: { what: "Highest speed of the motor shaft, in revolutions per minute.",
      effect: "Sets the CPSR with the base speed, the maximum electrical frequency and the rotor surface speed.",
      src: "Example case, constraint C2 (not more than)", st: "tgt" },
    D_so_max: { what: "Largest stator outer diameter that fits in the vehicle.",
      effect: "The calculated stator diameter is checked against it.",
      src: "Example case, constraint C4", st: "tgt" },
    L_max: { what: "Longest active length (the lamination stack, without end windings) that fits in the vehicle.",
      effect: "The calculated stack length is checked against it.",
      src: "Example case, constraint C4", st: "tgt" },
    tip_limit: { what: "Highest speed allowed at the rotor surface, in metres per second.",
      effect: "Rotor surface speed (π Dr n / 60) is checked against it. Interior PM rotors rely on thin steel bridges that limit it.",
      src: "Limit used in this calculator", st: "" }
  };

  var CHIP = { tgt: ["tgt", "Training target"], inf: ["inf", "Inferred"] };
  var uid = 0, bodies = [];

  function node(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }

  form.querySelectorAll(".fi").forEach(function (fi) {
    var inp = fi.querySelector("input[data-k]");
    if (!inp) return;
    var k = inp.dataset.k, h = H[k], lab = fi.querySelector("label");
    if (!h || !lab) return;
    var id = "hp-" + (++uid), unit = (fi.querySelector(".fi-in span") || {}).textContent || "";
    var def = S.DEFAULTS[k];
    var val = def === undefined ? "" : "Starting value: <b>" + def + (/^[—:\s]*$|^: 1$/.test(unit) ? (unit === ": 1" ? " : 1" : "") : " " + unit) + "</b>. ";
    var btn = node("button", "hp-btn", "?");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", id);
    btn.setAttribute("aria-label", "Help: " + lab.textContent.replace(/\s+/g, " ").trim());
    var sm = lab.querySelector("small");
    if (sm) lab.insertBefore(btn, sm); else lab.appendChild(btn);
    var chip = h.st ? ' <span class="chip ' + CHIP[h.st][0] + '">' + CHIP[h.st][1] + "</span>" : "";
    var body = node("div", "hp-body",
      "<p><b>What it is.</b> " + h.what + "</p>" +
      "<p><b>What it changes.</b> " + h.effect + "</p>" +
      '<p class="hp-src">' + val + "Source: " + h.src.replace(/\.$/, "") + "." + chip + "</p>");
    body.id = id;
    body.hidden = true;
    fi.insertAdjacentElement("afterend", body);
    bodies.push({ btn: btn, body: body });
    btn.addEventListener("click", function () { set(btn, body, body.hidden); });
  });

  function set(btn, body, open) {
    body.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  form.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var t = e.target.closest && e.target.closest(".fi");
    var next = t && t.nextElementSibling;
    if (next && next.classList.contains("hp-body") && !next.hidden) {
      var b = bodies.filter(function (x) { return x.body === next; })[0];
      if (b) { set(b.btn, b.body, false); b.btn.focus(); }
    }
  });

  // Walkthrough GIF: click (or Enter) to see it full size; click again or Esc to close.
  var gif = document.querySelector(".hp-gif img");
  if (gif && typeof HTMLDialogElement === "function") {
    gif.tabIndex = 0;
    gif.setAttribute("role", "button");
    gif.setAttribute("aria-label", "Enlarge the walkthrough");
    gif.insertAdjacentElement("afterend", node("span", "hp-gif-hint", "Click the animation to enlarge it."));
    var dlg = node("dialog", "hp-zoom");
    dlg.setAttribute("aria-label", "Walkthrough of the Sizing Calculator");
    var big = node("img");
    big.alt = gif.alt;
    dlg.appendChild(big);
    dlg.appendChild(node("p", "", "Click anywhere or press Esc to close."));
    document.body.appendChild(dlg);
    var open = function () { big.src = gif.currentSrc || gif.src; dlg.showModal(); };   // src read at open: on the course site it is a decrypted blob
    gif.addEventListener("click", open);
    gif.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    dlg.addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("close", function () { gif.focus(); });
  }

  var all = document.getElementById("hp-all");
  if (all) all.addEventListener("click", function () {
    var open = all.getAttribute("aria-pressed") !== "true";
    bodies.forEach(function (x) {
      // open the parent group so the help is visible
      var d = x.body.closest("details");
      if (open && d) d.open = true;
      set(x.btn, x.body, open);
    });
    all.setAttribute("aria-pressed", open ? "true" : "false");
    all.textContent = open ? "Hide help for all boxes" : "Show help for all boxes";
  });
})();
