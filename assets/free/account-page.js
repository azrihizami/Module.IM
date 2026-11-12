/* Motoreka free account page (/account/): create an account, sign in with the emailed link or code, accept the privacy
   notice, see progress and the certificate, edit the name on it, sign out, delete the account. */
(function () {
  "use strict";
  var MK = window.MK, A = window.ACC || {};
  var $ = function (s) { return document.querySelector(s); };
  var views = ["#acc-off", "#acc-out", "#acc-code", "#acc-consent", "#acc-in"];
  function show(id) { views.forEach(function (v) { var n = $(v); if (n) n.hidden = v !== id; }); window.scrollTo(0, 0); }
  function msg(node, text, ok) { node.className = "enq-msg " + (ok ? "ok" : "err"); node.textContent = text; node.hidden = !text; }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (attrs[k] == null) continue; if (k === "class") e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (text !== undefined) e.textContent = text; return e;
  }
  var next = (new URLSearchParams(location.search).get("next") || "").replace(/[^\w\/.\-]/g, "");
  if (next && next.charAt(0) !== "/") next = "";
  var back = location.origin + location.pathname + (next ? "?next=" + encodeURIComponent(next) : "");
  var email = "";

  if (!MK || !MK.configured) { show("#acc-off"); return; }

  // ---------- signed out: create an account, or sign in
  function busy(form, on, label) { var b = form.querySelector("button[type=submit]"); b.disabled = on; if (label) b.textContent = label; }
  var up = $("#f-signup"), inf = $("#f-signin");
  up.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = new FormData(up); email = String(f.get("email") || "");
    if (!f.get("consent")) { msg($("#signup-msg"), "Tick the box to accept the privacy notice."); return; }
    busy(up, true, "Sending…");
    MK.signUp({ email: email, name: String(f.get("name") || ""), organisation: String(f.get("organisation") || ""), role: String(f.get("role") || ""), updates: !!f.get("updates") }, back)
      .then(function () { codeView(); })
      .catch(function (er) { msg($("#signup-msg"), er.message); })
      .then(function () { busy(up, false, "Email me a sign-in link"); });
  });
  inf.addEventListener("submit", function (e) {
    e.preventDefault();
    email = String(new FormData(inf).get("email") || "");
    busy(inf, true, "Sending…");
    MK.signIn(email, back).then(function () { codeView(); })
      .catch(function (er) { msg($("#signin-msg"), er.message); })
      .then(function () { busy(inf, false, "Email me a sign-in link"); });
  });
  function codeView() { $("#code-email").textContent = email; msg($("#code-msg"), ""); show("#acc-code"); $("#f-code input[name=code]").focus(); }
  $("#f-code").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = String(new FormData(e.target).get("code") || "");
    busy(e.target, true, "Checking…");
    MK.verifyCode(email, code).then(function () { route(); })
      .catch(function (er) { msg($("#code-msg"), er.message); })
      .then(function () { busy(e.target, false, "Sign in"); });
  });
  $("#code-again").addEventListener("click", function () { show("#acc-out"); });

  // ---------- signed in, notice not yet accepted
  $("#f-consent").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = new FormData(e.target);
    if (!f.get("consent")) { msg($("#consent-msg"), "Tick the box to accept the privacy notice."); return; }
    busy(e.target, true, "Saving…");
    MK.acceptPrivacy({ name: String(f.get("name") || ""), organisation: String(f.get("organisation") || ""), role: String(f.get("role") || ""), updates: !!f.get("updates") })
      .then(route).catch(function (er) { msg($("#consent-msg"), er.message); })
      .then(function () { busy(e.target, false, "Save and continue"); });
  });

  // ---------- signed in
  function chip(text, cls) { return el("span", { class: "chip" + (cls ? " " + cls : "") }, text); }
  function renderCourse(d) {
    var list = $("#acc-lectures"); list.innerHTML = "";
    var passed = 0, out = 0;
    (d.lectures || []).forEach(function (l) {
      if (l.open) out++; if (l.passed) passed++;
      var li = el("li", { class: "lec" + (l.open ? "" : " coming") });
      li.appendChild(el("span", { class: "sno" }, "M" + l.n));
      var mid = el("span"); mid.appendChild(el("b", {}, l.title));
      var line = !l.open ? "Not out yet" : l.passed ? l.right + " of " + l.questions + " right" :
                 l.answered === l.questions ? l.right + " of " + l.questions + " right: " + l.pass_min + " needed" :
                 l.answered ? l.answered + " of " + l.questions + " questions answered" : "Not started";
      mid.appendChild(el("span", {}, line));
      if (l.open && A.lectures && A.lectures[l.id]) {
        var go = el("a", { href: A.lectures[l.id] }, l.passed ? "Watch again" : (l.answered ? "Continue" : "Watch"));
        mid.appendChild(go);
      }
      li.appendChild(mid);
      li.appendChild(!l.open ? chip("Coming") : l.passed ? chip("Passed", "ok") : l.answered === l.questions ? chip("Retake") : chip(l.answered ? "In progress" : "Open"));
      list.appendChild(li);
    });
    var total = (d.course && d.course.lectures_total) || 6;
    $("#acc-count").textContent = passed + " of " + total + " lectures passed";
    var c = $("#acc-cert"); c.innerHTML = "";
    if (d.certificate) {
      c.appendChild(el("p", {}, "Your certificate was issued on " + new Date(d.certificate.issued_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) + "."));
      c.appendChild(el("a", { class: "btn copper", href: A.certificate + "?c=" + d.certificate.code }, "View your certificate"));
    } else if (passed >= total && out >= total) {
      c.appendChild(el("p", {}, "You passed every lecture. Check your name below: it is printed on the certificate."));
      var b = el("button", { type: "button", class: "btn copper" }, "Get your certificate");
      b.addEventListener("click", function () {
        b.disabled = true;
        MK.claim(A.course).then(function (r) { location.href = A.certificate + "?c=" + r.code; })
          .catch(function (er) { b.disabled = false; c.appendChild(el("p", { class: "enq-msg err" }, er.message)); });
      });
      c.appendChild(b);
    } else {
      c.appendChild(el("p", {}, out < total
        ? "Pass each lecture (2 of its 3 questions right) for the certificate. It opens when all " + total + " lectures are out; " + out + " are out now."
        : "Pass each lecture (2 of its 3 questions right) for the certificate."));
    }
  }
  function renderIn(me) {
    $("#acc-name").textContent = me.name || "there";
    var f = $("#f-profile");
    f.name.value = me.name || ""; f.organisation.value = me.organisation || ""; f.role.value = me.role || ""; f.updates.checked = !!me.updates;
    $("#acc-email").textContent = (MK.state.user && MK.state.user.email) || "";
    var nb = $("#acc-next"); nb.hidden = !next; if (next) nb.querySelector("a").href = next;
    show("#acc-in");
    MK.course(A.course).then(renderCourse).catch(function (er) { $("#acc-lectures").textContent = er.message; });
  }
  $("#f-profile").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    if (f.name.value.trim().length < 2) { msg($("#profile-msg"), "Give your name as it should appear on the certificate."); return; }
    busy(f, true, "Saving…");
    MK.saveProfile({ name: f.name.value, organisation: f.organisation.value, role: f.role.value, updates: f.updates.checked })
      .then(function () { msg($("#profile-msg"), "Saved.", true); $("#acc-name").textContent = f.name.value.trim(); })
      .catch(function (er) { msg($("#profile-msg"), er.message); })
      .then(function () { busy(f, false, "Save"); });
  });
  $("#acc-signout").addEventListener("click", function () { MK.signOut().then(function () { show("#acc-out"); }); });
  $("#acc-delete").addEventListener("click", function () { $("#acc-delete-confirm").hidden = false; $("#acc-delete").hidden = true; });
  $("#acc-delete-no").addEventListener("click", function () { $("#acc-delete-confirm").hidden = true; $("#acc-delete").hidden = false; });
  $("#acc-delete-yes").addEventListener("click", function (e) {
    e.target.disabled = true;
    MK.deleteAccount().then(function () { show("#acc-out"); msg($("#signup-msg"), "Your account and everything recorded with it are deleted.", true); })
      .catch(function (er) { e.target.disabled = false; msg($("#delete-msg"), er.message); });
  });

  // ---------- which view
  function route() {
    return MK.ready.then(function (st) {
      if (!st.user) { show(location.hash === "#signin" ? "#acc-out" : "#acc-out"); if (location.hash === "#signin") $("#f-signin input[name=email]").focus(); return; }
      return MK.learner().then(function (me) {
        if (!me || !me.consent_at) {
          var f = $("#f-consent"); if (me) { f.name.value = me.name || ""; f.organisation.value = me.organisation || ""; f.role.value = me.role || ""; }
          show("#acc-consent"); return;
        }
        renderIn(me);
      });
    }).catch(function (er) { show("#acc-out"); msg($("#signin-msg"), er.message); });
  }
  MK.onAuth(function (ev) { if (ev === "SIGNED_IN") route(); });
  route();
})();
