// Applies the visitor's saved theme before first paint. "system" (the default) sets nothing and
// follows prefers-color-scheme. Kept tiny and external so the page's CSP needs no inline script.
;(function () {
  try {
    var t = localStorage.getItem('devdock-site-theme')
    if (t && /^(light|dark)$/.test(t)) document.documentElement.dataset.theme = t
  } catch {
    // Storage blocked: follow the system theme.
  }
})()
