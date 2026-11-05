// Preview link for a new look: ?look=next loads look-next.css on top of the live look and
// remembers it on this device; ?look=live goes back. The live site is unchanged for everyone
// else. Runs in <head> so the page never flashes the old look.
(function () {
  var q = new URLSearchParams(location.search).get("look"), on = false;
  try {
    if (q === "next") localStorage.setItem("look", "next");
    if (q === "live") localStorage.removeItem("look");
    on = localStorage.getItem("look") === "next";
  } catch (e) { on = q === "next"; }
  if (!on) return;
  var l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "/look-next.css?v=" + (document.currentScript && document.currentScript.dataset.v || "1");
  document.head.appendChild(l);
  document.documentElement.dataset.look = "next";
})();
