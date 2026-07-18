// Mirrors the few /hub-sdk.js helpers that pure logic depends on, so
// __tests__ can import logic.js without the browser-only SDK. index.html
// imports the real implementations from /hub-sdk.js.

export function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export function isAdult(member) {
  return member?.role === "adult";
}
