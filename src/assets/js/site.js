/* Hakase BioSim — progressive enhancement only. Every page reads completely without this file. */
(function () {
  "use strict";
  document.documentElement.classList.add("js");

  // Theme: light by default; the toggle stores a choice for this browser only
  var root = document.documentElement;
  function applyTheme(t) {
    root.setAttribute("data-theme", t);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
    });
  }
  var stored = null;
  try { stored = localStorage.getItem("hakase-theme"); } catch (e) {}
  applyTheme(stored === "dark" ? "dark" : "light");
  document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
    b.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      try { localStorage.setItem("hakase-theme", next); } catch (e) {}
      applyTheme(next);
    });
  });
  if (window.MutationObserver) {
    new MutationObserver(function () {
      var want = null;
      try { want = localStorage.getItem("hakase-theme"); } catch (e) {}
      want = want === "dark" ? "dark" : "light";
      if (root.getAttribute("data-theme") !== want) root.setAttribute("data-theme", want);
    }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  }

  // Mobile navigation
  var btn = document.querySelector(".menu-btn");
  var nav = document.getElementById("site-nav");
  if (btn && nav) {
    btn.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.textContent = open ? "Close" : "Menu";
    });
  }

  // Study-plan explorer: tabs over panels that are all present in the HTML
  document.querySelectorAll("[data-explorer]").forEach(function (root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
    var panels = tabs.map(function (t) { return document.getElementById(t.getAttribute("aria-controls")); });
    function select(i, focus) {
      tabs.forEach(function (t, j) {
        var on = i === j;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        if (panels[j]) panels[j].hidden = !on;
      });
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(i, false); });
      t.addEventListener("keydown", function (e) {
        var k = e.key, n = tabs.length, next = null;
        if (k === "ArrowDown" || k === "ArrowRight") next = (i + 1) % n;
        if (k === "ArrowUp" || k === "ArrowLeft") next = (i - 1 + n) % n;
        if (k === "Home") next = 0;
        if (k === "End") next = n - 1;
        if (next !== null) { e.preventDefault(); select(next, true); }
      });
    });
    select(0, false);
  });

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
