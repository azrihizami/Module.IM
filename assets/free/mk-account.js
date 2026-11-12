/* Motoreka free accounts: the shared layer for the account, lecture and certificate pages.
   Needs assets/free/supabase.js (the Supabase client, vendored) and window.MK_CONFIG = {url, key} (the project URL and the
   publishable key: both are public by design; row-level security on the server decides what each visitor may read or write).
   Sign-in is by email: a link and a six-digit code arrive in one email; either works. Nothing here stores a password. */
(function () {
  "use strict";
  var C = window.MK_CONFIG || {};
  var configured = !!(C.url && C.key && window.supabase && window.supabase.createClient);
  var sb = configured ? window.supabase.createClient(C.url, C.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit", storageKey: "mk-free-auth" }
  }) : null;

  function err(e) {
    // Turn server messages into short sentences for the page.
    var m = (e && (e.message || e.error_description || e.msg)) || String(e || "");
    if (/rate limit|too many|429/i.test(m)) return "Too many emails were sent just now. Wait a minute and try again.";
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "No connection to the server. Check your connection and try again.";
    if (/Signups not allowed|User not found|not found/i.test(m) && /otp|user/i.test(m)) return "There is no account with this email yet. Create one first.";
    if (/Token has expired|invalid/i.test(m) && /token|otp/i.test(m)) return "That code is wrong or has expired. Ask for a new email.";
    return m.replace(/^.*?:\s*(?=[A-Z])/, "") || "Something went wrong. Try again.";
  }
  function src() {
    try { return sessionStorage.getItem("mk-src") || new URLSearchParams(location.search).get("src") || ""; } catch (e) { return ""; }
  }
  function need() { if (!configured) throw new Error("Free accounts are not connected yet."); }
  function rpc(name, args) {
    need();
    return sb.rpc(name, args || {}).then(function (r) { if (r.error) throw new Error(err(r.error)); return r.data; });
  }

  var listeners = [];
  var state = { session: null, user: null };
  var ready = configured ? sb.auth.getSession().then(function (r) {
    state.session = r.data.session; state.user = r.data.session ? r.data.session.user : null;
    // the sign-in link brings the tokens in the address: tidy it once they are read
    if (/access_token=|error_description=/.test(location.hash)) {
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    }
    return state;
  }).catch(function () { return state; }) : Promise.resolve(state);
  if (configured) sb.auth.onAuthStateChange(function (ev, session) {
    state.session = session; state.user = session ? session.user : null;
    listeners.forEach(function (fn) { try { fn(ev, state); } catch (e) {} });
  });

  window.MK = {
    configured: configured,
    ready: ready,
    state: state,
    onAuth: function (fn) { listeners.push(fn); },
    err: err,

    // ---- sign-up and sign-in: one email with a link and a six-digit code
    signUp: function (f, back) {
      need();
      return sb.auth.signInWithOtp({ email: f.email.trim(), options: {
        shouldCreateUser: true, emailRedirectTo: back || location.href.split("#")[0],
        data: { name: f.name.trim(), organisation: (f.organisation || "").trim(), role: (f.role || "").trim(),
                updates: !!f.updates, consent: true, src: src() } } })
        .then(function (r) { if (r.error) throw new Error(err(r.error)); });
    },
    signIn: function (email, back) {
      need();
      return sb.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: back || location.href.split("#")[0] } })
        .then(function (r) { if (r.error) throw new Error(err(r.error)); });
    },
    verifyCode: function (email, code) {
      need();
      return sb.auth.verifyOtp({ email: email.trim(), token: String(code).replace(/\D/g, ""), type: "email" })
        .then(function (r) { if (r.error) throw new Error(err(r.error)); return r.data; });
    },
    signOut: function () { return configured ? sb.auth.signOut() : Promise.resolve(); },

    // ---- the learner
    learner: function () {
      need();
      return sb.from("learners").select("name, organisation, role, updates, consent_at, created_at").maybeSingle()
        .then(function (r) { if (r.error) throw new Error(err(r.error)); return r.data; });
    },
    saveProfile: function (p) {
      need();
      return sb.from("learners").update({ name: p.name.trim(), organisation: (p.organisation || "").trim(), role: (p.role || "").trim(), updates: !!p.updates })
        .eq("id", state.user.id).then(function (r) { if (r.error) throw new Error(err(r.error)); });
    },
    acceptPrivacy: function (p) { return rpc("accept_privacy", { p_name: p.name, p_organisation: p.organisation || "", p_role: p.role || "", p_updates: !!p.updates }); },
    deleteAccount: function () { return rpc("delete_my_account").then(function () { return sb.auth.signOut(); }); },

    // ---- quizzes and progress
    answers: function (ids) {
      need();
      return sb.from("answers").select("question_id, ok, tries, closed, last_choice").in("question_id", ids)
        .then(function (r) { if (r.error) throw new Error(err(r.error)); var m = {}; (r.data || []).forEach(function (a) { m[a.question_id] = a; }); return m; });
    },
    submit: function (qid, choice) { return rpc("submit_answer", { p_question: qid, p_choice: choice }); },
    retake: function (lecture) { return rpc("retake_lecture", { p_lecture: lecture }); },
    progress: function (lecture) {
      need();
      return sb.from("progress").select("pos, done").eq("lecture_id", lecture).maybeSingle()
        .then(function (r) { return r.error ? null : r.data; });
    },
    saveProgress: function (lecture, pos, done) {
      if (!configured || !state.user) return Promise.resolve();
      var row = { user_id: state.user.id, lecture_id: lecture, pos: Math.max(0, Math.round(pos || 0)), updated_at: new Date().toISOString() };
      if (done) row.done = true;
      return sb.from("progress").upsert(row, { onConflict: "user_id,lecture_id" }).then(function () {}, function () {});
    },
    course: function (id) { return rpc("my_course", { p_course: id }); },
    claim: function (id) { return rpc("claim_certificate", { p_course: id }); },
    check: function (code) { return rpc("check_certificate", { p_code: code }); }
  };
})();
