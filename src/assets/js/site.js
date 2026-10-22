/* Hakase BioSim — progressive enhancement only. Every page reads completely without this file. */
(function () {
  "use strict";
  document.documentElement.classList.add("js");

  var header = document.querySelector(".site-header");

  // Mobile navigation
  var btn = document.querySelector(".menu-btn");
  var nav = document.getElementById("site-nav");
  if (btn && nav) {
    btn.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.textContent = open ? "Close" : "Menu";
      if (header) header.classList.toggle("is-menu-open", open);
    });
  }

  // Header over the opening hero or band: clear at the very top, joined to it while it is
  // under the header, solid and light once it has scrolled away. One read per frame at most.
  var band = header && header.classList.contains("is-overlay") ? document.querySelector("main > section:first-child") : null;
  var art = band ? band.querySelector(".hero-art img") : null;
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (band) {
    var ticking = false;
    var update = function () {
      ticking = false;
      header.classList.toggle("is-top", window.scrollY < 8);
      var rect = band.getBoundingClientRect();
      header.classList.toggle("is-past-band", rect.bottom <= header.offsetHeight);
      // the hero render drifts down at 6% of the scroll while the hero is on screen: depth, not decoration
      if (art && !still && rect.bottom > 0 && window.innerWidth >= 900) art.style.transform = "scale(1.1) translate3d(0," + Math.round(-rect.top * 0.06) + "px,0)";
    };
    var request = function () { if (!ticking) { ticking = true; window.requestAnimationFrame(update); } };
    update();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
  }

  // Request forms: compose the message for the visitor's own email app.
  // Nothing is sent from this page; the visitor sends it, or copies it.
  document.querySelectorAll("form[data-compose]").forEach(function (form) {
    var to = form.getAttribute("data-to");
    var subjectBase = form.getAttribute("data-subject") || "Enquiry";
    var done = form.parentNode.querySelector(".form-done");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var lines = [], name = "", org = "";
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.type === "submit") return;
        var label = form.querySelector('label[for="' + el.id + '"]');
        var v = (el.value || "").trim();
        if (!v) return;
        if (el.name === "name") name = v;
        if (el.name === "organisation") org = v;
        lines.push((label ? label.textContent.replace(/\s*\(optional\)\s*/i, "") : el.name) + ": " + v);
      });
      var subject = subjectBase + (org ? " — " + org : name ? " — " + name : "");
      var body = lines.join("\n");
      var href = "mailto:" + to + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
      if (done) {
        done.querySelector("pre").textContent = "To: " + to + "\nSubject: " + subject + "\n\n" + body;
        done.querySelector("a.mail").setAttribute("href", href);
        done.hidden = false;
        form.hidden = true;
        done.querySelector("h3").focus();
      }
    });
    if (done) {
      var copy = done.querySelector("button.copy");
      if (copy) copy.addEventListener("click", function () {
        var text = done.querySelector("pre").textContent;
        var ok = function () { copy.textContent = "Copied"; };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(ok, function () { selectPre(); });
        } else { selectPre(); }
        function selectPre() { var r = document.createRange(); r.selectNodeContents(done.querySelector("pre")); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); copy.textContent = "Selected — press Ctrl/⌘ C"; }
      });
      var edit = done.querySelector("button.edit");
      if (edit) edit.addEventListener("click", function () { done.hidden = true; form.hidden = false; });
    }
  });
})();
