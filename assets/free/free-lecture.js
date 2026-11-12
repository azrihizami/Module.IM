/* Motoreka free lecture page: the video with its quiz stops, chapters and captions.
   Reads window.FREE_LEC (written by web/build_free_account.py from mfg_content.py, without the answers).
   Signed in: answers are graded by the server (MK.submit), progress is saved to the account.
   Not signed in: the video plays; at each stop the question is shown with an invitation to the free account. */
(function () {
  "use strict";
  var L = window.FREE_LEC, MK = window.MK;
  if (!L) return;
  var WINDOW = 1.5, CAPKEY = "motoreka-captions", LOCAL = "mk-free-pos";
  var root = document.querySelector(".flec"); if (!root) return;
  var box = root.querySelector(".lvid"), bar = root.querySelector(".lbar"), cap = root.querySelector(".lcap"),
      chap = root.querySelector(".lchap"), end = root.querySelector(".lend"), who = root.querySelector(".fwho");
  var cues = L.cues.slice().sort(function (a, b) { return a.t - b.t; });
  var answers = {}, signedIn = false, consent = false, asking = null, skipped = {}, player = null, captions = null, duration = 0, lastSave = 0;
  var capOn = pref(CAPKEY) === "1", pos = 0;

  function pref(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function fmt(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (attrs[k] == null) continue; if (k === "class") e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (text !== undefined) e.textContent = text; return e;
  }
  function accountUrl(hash) { return L.account + "?next=" + encodeURIComponent(location.pathname) + (hash || ""); }
  function localPos(v) {
    try { var a = JSON.parse(localStorage.getItem(LOCAL) || "{}"); if (v === undefined) return a[L.id] || 0; a[L.id] = v; localStorage.setItem(LOCAL, JSON.stringify(a)); } catch (e) { return 0; }
  }

  // ---------- who is watching
  function showWho() {
    if (!who) return;
    who.innerHTML = "";
    if (!MK || !MK.configured) { who.appendChild(el("span", { class: "note" }, "Free accounts open soon. The video and chapters are open to everyone.")); return; }
    if (signedIn && consent) {
      who.appendChild(el("span", { class: "note" }, "Signed in: your answers count towards the certificate."));
      var a = el("a", { href: L.account }, "Your progress"); who.appendChild(a);
    } else if (signedIn) {
      who.appendChild(el("span", { class: "note" }, "One step left: accept the privacy notice to save your answers."));
      who.appendChild(el("a", { class: "btn line", href: accountUrl() }, "Finish your account"));
    } else {
      who.appendChild(el("span", { class: "note" }, "Answer the questions with a free account, and earn the certificate."));
      who.appendChild(el("a", { class: "btn solid", href: accountUrl("#signup") }, "Create a free account"));
      who.appendChild(el("a", { class: "btn line", href: accountUrl("#signin") }, "Sign in"));
    }
  }
  function load() {
    if (!MK || !MK.configured) { showWho(); return Promise.resolve(); }
    return MK.ready.then(function (st) {
      signedIn = !!st.user;
      if (!signedIn) { showWho(); return; }
      return Promise.all([MK.learner(), MK.answers(cues.map(function (c) { return c.id; })), MK.progress(L.id)]).then(function (r) {
        consent = !!(r[0] && r[0].consent_at); answers = r[1] || {};
        if (r[2] && r[2].pos) pos = r[2].pos;
        showWho(); markChapters(pos);
      }).catch(function () { showWho(); });
    });
  }

  // ---------- the YouTube player (IFrame API, no-cookie host)
  function youtube(video, cb) {
    var host = el("div"); box.appendChild(host);
    var P = null, ready = false, timer = null, pendingSeek = null, failed = false;
    function fail(m) { if (failed) return; failed = true; clearInterval(timer); cb.error(m || "The video could not be loaded. Check the connection and reload the page."); }
    function make() {
      var vars = { rel: 0, modestbranding: 1, playsinline: 1, enablejsapi: 1 };
      if (/^https?:/.test(location.protocol)) vars.origin = location.origin;
      P = new YT.Player(host, { host: "https://www.youtube-nocookie.com", videoId: video.id, width: "100%", height: "100%", playerVars: vars, events: {
        onReady: function () { ready = true; cb.ready(P.getDuration()); if (pendingSeek !== null) { P.seekTo(pendingSeek, true); pendingSeek = null; } },
        onStateChange: function (e) {
          clearInterval(timer);
          if (e.data === YT.PlayerState.PLAYING) { timer = setInterval(function () { cb.time(P.getCurrentTime()); }, 200); cb.state("playing"); }
          else if (e.data === YT.PlayerState.ENDED) cb.ended();
          else if (e.data === YT.PlayerState.PAUSED) cb.state("paused");
        },
        onError: function () { fail("This video is not available right now."); }
      } });
    }
    if (window.YT && YT.Player) make();
    else {
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (prev) prev(); make(); };
      var s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true;
      s.onerror = function () { fail(); }; document.head.appendChild(s);
      setTimeout(function () { if (!P) fail(); }, 15000);
    }
    return { play: function () { if (ready) P.playVideo(); }, pause: function () { if (ready) P.pauseVideo(); },
             seek: function (t) { if (ready) P.seekTo(t, true); else pendingSeek = t; }, time: function () { return ready ? P.getCurrentTime() : 0; } };
  }

  // ---------- captions (WebVTT)
  function ts(x) { var p = x.trim().split(":").map(parseFloat); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; }
  function parseVTT(txt) {
    var out = [];
    txt.replace(/\r/g, "").split(/\n\n+/).forEach(function (b) {
      var lines = b.split("\n"), i = 0;
      if (/^(WEBVTT|NOTE|STYLE|REGION)/.test(lines[0])) return;
      if (lines[i].indexOf("-->") < 0) i++;
      if (!lines[i] || lines[i].indexOf("-->") < 0) return;
      var m = lines[i].match(/([\d:.]+)\s*-->\s*([\d:.]+)/); if (!m) return;
      out.push({ s: ts(m[1]), e: ts(m[2]), text: lines.slice(i + 1).join("\n").replace(/<[^>]+>/g, "") });
    });
    return out;
  }

  // ---------- chapters
  var items = chap ? chap.querySelectorAll("li[data-t]") : [];
  Array.prototype.forEach.call(items, function (li) {
    li.querySelector("button").addEventListener("click", function () { if (asking || !player) return; hideEnd(); player.seek(+li.getAttribute("data-t")); player.play(); });
  });
  function markChapters(s) {
    var cur = -1;
    for (var i = 0; i < items.length; i++) if (+items[i].getAttribute("data-t") <= s) cur = i;
    for (var j = 0; j < items.length; j++) {
      if (j === cur) items[j].setAttribute("aria-current", "true"); else items[j].removeAttribute("aria-current");
      var q = items[j].querySelector(".lchap-q"); if (!q) continue;
      var a = answers[q.getAttribute("data-cue")];
      q.textContent = a && a.closed ? (a.ok ? "✓" : "✗") : "?";
      q.className = "lchap-q" + (a && a.closed ? (a.ok ? " right" : " wrong") : "");
    }
  }

  // ---------- playing
  function save(force, done) {
    var now = Date.now(); if (!force && now - lastSave < 15000) return; lastSave = now;
    localPos(pos);
    if (signedIn && MK) MK.saveProgress(L.id, pos, done);
  }
  function onTime(s) {
    pos = s; save(false); markChapters(s);
    if (captions && capOn) { var line = ""; for (var i = 0; i < captions.length; i++) if (s >= captions[i].s && s < captions[i].e) { line = captions[i].text; break; } if (cap.textContent !== line) cap.textContent = line; }
    if (asking) return;
    for (var k = 0; k < cues.length; k++) {
      var c = cues[k], a = answers[c.id];
      if (!(a && a.closed) && !skipped[c.id] && s >= c.t && s < c.t + WINDOW) { ask(c, false); return; }
    }
  }

  // ---------- the question overlay
  var overlay = el("div", { class: "lq", hidden: "" });
  var lastFocus = null;
  function setInert(on) {
    Array.prototype.forEach.call(box.children, function (n) { if (n !== overlay) { if (on) n.setAttribute("inert", ""); else n.removeAttribute("inert"); } });
    [chap, bar, end].forEach(function (n) { if (!n) return; if (on) n.setAttribute("inert", ""); else n.removeAttribute("inert"); });
  }
  function close(resume) {
    overlay.hidden = true; overlay.innerHTML = ""; setInert(false); asking = null;
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
    if (resume && player) player.play();
  }
  function ask(c, fromEnd) {
    asking = c; if (player) player.pause(); lastFocus = document.activeElement;
    var n = cues.indexOf(c) + 1, a = answers[c.id];
    overlay.innerHTML = "";
    var dlg = el("div", { class: "lq-box", role: "dialog", "aria-modal": "true", "aria-labelledby": "lq-h" });
    var form = el("form", { class: "lq-form", novalidate: "" }), fs = el("fieldset", { class: "q" });
    var lg = el("legend", { id: "lq-h", tabindex: "-1" }); lg.appendChild(el("span", { class: "q-n" }, "Question " + n + " of " + cues.length)); lg.appendChild(el("span", { class: "q-t" }, c.q)); fs.appendChild(lg);
    c.opts.forEach(function (o, j) {
      var lab = el("label", { class: "qopt" }), inp = el("input", { type: "radio", name: "lq", value: String(j) });
      lab.appendChild(inp); lab.appendChild(el("span", {}, o)); fs.appendChild(lab);
    });
    var why = el("p", { class: "q-why", hidden: "" }), fb = el("p", { class: "lq-fb", role: "status", "aria-live": "polite" }), act = el("div", { class: "actions" });
    fs.appendChild(why); fs.appendChild(fb); fs.appendChild(act); form.appendChild(fs); dlg.appendChild(form); overlay.appendChild(dlg);

    function cont(label) {
      var b = el("button", { type: "button", class: "btn solid" }, label || (fromEnd ? "Back to the results" : "Continue the lecture"));
      b.addEventListener("click", function () { close(!fromEnd); if (fromEnd) showEnd(); }); return b;
    }
    function replay() {
      var b = el("button", { type: "button", class: "btn line" }, "Replay the chapter");
      b.addEventListener("click", function () { close(false); hideEnd(); player.seek(c.back || 0); player.play(); }); return b;
    }
    function reveal(r) {
      form.querySelectorAll("input").forEach(function (x) { x.disabled = true; });
      form.querySelectorAll(".qopt").forEach(function (o, j) { o.classList.toggle("is-a", j === r.correct); });
      why.textContent = r.why || ""; why.hidden = !r.why; fs.classList.add(r.ok ? "right" : "wrong");
    }

    if (!signedIn || !consent || !MK || !MK.configured) {
      // the question is shown; answering needs the free account
      form.querySelectorAll("input").forEach(function (x) { x.disabled = true; });
      fb.textContent = (MK && MK.configured)
        ? (signedIn ? "Accept the privacy notice in your account to answer and keep your score." : "Answer this question with a free account. Your answers count towards the certificate.")
        : "Questions open with the free accounts. For now, think of your answer and carry on.";
      if (MK && MK.configured) act.appendChild(el("a", { class: "btn solid", href: accountUrl(signedIn ? "" : "#signup") }, signedIn ? "Finish your account" : "Create a free account"));
      var skip = el("button", { type: "button", class: "btn line" }, "Skip for now");
      skip.addEventListener("click", function () { skipped[c.id] = true; close(!fromEnd); if (fromEnd) showEnd(); });
      act.appendChild(skip);
    } else if (a && a.closed) {
      fb.textContent = a.ok ? "You answered this one right." : "This one is closed: two tries were used.";
      form.querySelectorAll("input").forEach(function (x) { x.disabled = true; });
      act.appendChild(cont());
    } else {
      var check = el("button", { type: "submit", class: "btn solid" }, "Check");
      act.appendChild(check);
      if (a && a.tries === 1) fb.textContent = "Second try: the first answer was not right.";
      if (a && a.tries === 1 && a.last_choice != null) { var w = form.querySelectorAll("input")[a.last_choice]; if (w) { w.disabled = true; w.parentNode.classList.add("tried"); } }
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var s = form.querySelector("input:checked");
        if (!s) { fb.textContent = "Choose an answer first."; return; }
        check.disabled = true; fb.textContent = "Checking…";
        MK.submit(c.id, +s.value).then(function (r) {
          answers[c.id] = { question_id: c.id, ok: r.ok, tries: r.tries, closed: r.closed, last_choice: +s.value };
          act.innerHTML = ""; markChapters(pos);
          if (r.ok) { reveal(r); fb.textContent = r.tries > 1 ? "Right, on the second try." : "Right."; act.appendChild(cont()); }
          else if (!r.closed) {
            s.checked = false; s.disabled = true; s.parentNode.classList.add("tried");
            fb.textContent = "Not quite. You have one more try. Replay the chapter first if you like.";
            check.disabled = false; act.appendChild(replay()); act.appendChild(check);
          } else { reveal(r); fb.textContent = "Not this time. The right answer is marked."; act.appendChild(cont()); }
          var b = act.querySelector(".btn.solid"); if (b) b.focus();
        }).catch(function (e2) { check.disabled = false; fb.textContent = (MK.err(e2) || "It did not save.") + " Try again."; });
      });
    }
    overlay.hidden = false; setInert(true); lg.focus();
  }
  overlay.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); return; }
    if (e.key !== "Tab") return;
    var f = Array.prototype.filter.call(overlay.querySelectorAll("a[href], input:not([disabled]), button:not([disabled])"), function () { return true; });
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });

  // ---------- the end of the lecture
  function hideEnd() { if (end) end.hidden = true; }
  function showEnd() {
    if (!end) return; end.hidden = false;
    var list = end.querySelector(".lres"), h = end.querySelector(".lend-h"), act = end.querySelector(".lend-act");
    list.innerHTML = ""; act.innerHTML = "";
    var right = 0, open = 0;
    cues.forEach(function (c, i) {
      var a = answers[c.id], st = a && a.closed ? (a.ok ? "right" : "wrong") : "open";
      if (a && a.ok) right++; if (st === "open") open++;
      var li = el("li", { class: st }); li.appendChild(el("span", { class: "q-n" }, "Q" + (i + 1))); li.appendChild(el("span", {}, c.q));
      li.appendChild(el("b", {}, st === "right" ? "Right" : st === "wrong" ? "Wrong" : "Not answered"));
      if (st === "open") { var b = el("button", { type: "button", class: "btn line" }, "Answer"); b.addEventListener("click", function () { ask(c, true); }); li.appendChild(b); }
      list.appendChild(li);
    });
    if (!signedIn || !consent) {
      h.textContent = "End of the lecture. With a free account your answers are saved and count towards the certificate.";
      if (MK && MK.configured) act.appendChild(el("a", { class: "btn solid", href: accountUrl(signedIn ? "" : "#signup") }, signedIn ? "Finish your account" : "Create a free account"));
    } else if (open) {
      h.textContent = open + (open === 1 ? " question is" : " questions are") + " still open. Answer " + (open === 1 ? "it" : "them") + " to finish the lecture.";
    } else if (right >= L.pass_min) {
      h.textContent = "Lecture passed: " + right + " of " + cues.length + " right.";
      act.appendChild(el("a", { class: "btn line", href: L.account }, "Your progress"));
    } else {
      h.textContent = right + " of " + cues.length + " right: " + L.pass_min + " are needed to pass. Watch it again and retake the questions.";
      var rt = el("button", { type: "button", class: "btn solid" }, "Retake the questions");
      rt.addEventListener("click", function () {
        rt.disabled = true;
        MK.retake(L.id).then(function () { answers = {}; markChapters(0); hideEnd(); player.seek(0); player.play(); })
          .catch(function (e) { rt.disabled = false; h.textContent = MK.err(e); });
      });
      act.appendChild(rt);
    }
    if (L.next) act.appendChild(el("a", { class: "btn line", href: L.next.href }, "Next: " + L.next.title));
    h.setAttribute("tabindex", "-1"); if (!asking) h.focus();
  }
  function onEnded() { pos = duration || pos; save(true, true); showEnd(); }

  // ---------- start
  var ph = box.querySelector(".lvid-ph"); if (ph) ph.remove();
  box.appendChild(overlay);
  if (L.captions) {
    var cbtn = el("button", { type: "button", class: "btn line sm", "aria-pressed": capOn ? "true" : "false" }, "Captions");
    cbtn.addEventListener("click", function () { capOn = !capOn; cbtn.setAttribute("aria-pressed", capOn ? "true" : "false"); pref(CAPKEY, capOn ? "1" : "0"); if (!capOn) cap.textContent = ""; });
    bar.insertBefore(cbtn, bar.firstChild);
    fetch(L.captions).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (t) { captions = parseVTT(t); })
      .catch(function () { cbtn.disabled = true; });
  }
  pos = localPos() || 0;
  load().then(function () {
    player = youtube(L.video, {
      ready: function (d) {
        duration = d || 0;
        if (pos > 10 && (!duration || pos < duration - 5)) {
          var r = el("button", { type: "button", class: "btn line sm" }, "Resume from " + fmt(pos));
          r.addEventListener("click", function () { player.seek(pos); player.play(); r.remove(); });
          bar.insertBefore(r, bar.firstChild);
        }
      },
      time: onTime, state: function (s) { if (s === "paused") save(true); }, ended: onEnded,
      error: function (m) { var e = el("div", { class: "lvid-ph", role: "alert" }); e.appendChild(el("b", {}, m)); box.insertBefore(e, overlay); }
    });
  });
  if (MK && MK.configured) MK.onAuth(function (ev) { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") load(); });
  window.addEventListener("pagehide", function () { save(true); });
  document.addEventListener("visibilitychange", function () { if (document.hidden) save(true); });
})();
