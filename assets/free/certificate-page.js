/* Motoreka certificate check (/certificate/?c=CODE): anyone can open the link; the server returns only the name, the
   course, the score and the date. The page draws the certificate, prints it on one A4 page and adds it to LinkedIn. */
(function () {
  "use strict";
  var MK = window.MK, $ = function (s) { return document.querySelector(s); };
  var code = (new URLSearchParams(location.search).get("c") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  var form = $("#cert-find"), out = $("#cert-out"), none = $("#cert-none");
  function fill(sel, text) { Array.prototype.forEach.call(document.querySelectorAll(sel), function (n) { n.textContent = text; }); }
  function find(c) {
    none.hidden = true;
    if (!c) { form.hidden = false; return; }
    if (!MK || !MK.configured) { none.hidden = false; none.textContent = "Certificates can be checked once free accounts open."; return; }
    MK.check(c).then(function (r) {
      if (!r) { none.hidden = false; none.textContent = "There is no certificate with the code " + c + ". Check the code and try again."; form.hidden = false; return; }
      var d = new Date(r.issued_at);
      fill("[data-c=name]", r.name); fill("[data-c=title]", r.cert_title); fill("[data-c=course]", r.course);
      fill("[data-c=date]", d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }));
      fill("[data-c=score]", r.score + " of " + r.out_of); fill("[data-c=code]", r.code.slice(0, 5) + "-" + r.code.slice(5));
      var url = location.origin + location.pathname + "?c=" + r.code;
      fill("[data-c=url]", url.replace(/^https?:\/\//, ""));
      document.title = r.name + " · " + r.course + " · Motoreka certificate";
      var li = "https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=" + encodeURIComponent(r.course) +
        "&organizationName=" + encodeURIComponent("Motoreka (UMPSA)") + "&issueYear=" + d.getFullYear() + "&issueMonth=" + (d.getMonth() + 1) +
        "&certUrl=" + encodeURIComponent(url) + "&certId=" + encodeURIComponent(r.code);
      $("#cert-li").href = li;
      out.hidden = false; form.hidden = true;
    }).catch(function (e) { none.hidden = false; none.textContent = MK.err(e); form.hidden = false; });
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var c = String(new FormData(form).get("c") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    history.replaceState(null, "", location.pathname + "?c=" + c); find(c);
  });
  $("#cert-print").addEventListener("click", function () { window.print(); });
  find(code);
})();
