// Applies the saved theme (see src/theme.ts) before the first paint, so a dark start screen doesn't
// flash white. A file of its own, not inline in index.html: the server's CSP allows only 'self' scripts.
try {
  document.documentElement.dataset.theme = localStorage.getItem("pdf-flex:dark-mode") === "on" ? "dark" : "light";
} catch {}
