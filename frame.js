// iPhone Safari fills the area behind the clock with whatever lies just above the top of
// the screen. A strip of background sits there (--above in app.css) and the window opens
// scrolled down by exactly that strip and stays there, so the clock sits on the page background,
// not on a flat colour. Only .page scrolls for the person using the app.
// Same frame as ivolopes.com.
(function () {
  var y = 160;
  function keep() { if (Math.abs(window.scrollY - y) > 0.5) window.scrollTo(0, y); }
  keep();
  document.addEventListener("DOMContentLoaded", keep);
  window.addEventListener("load", keep);
  window.addEventListener("resize", keep);
  window.addEventListener("pageshow", keep);
  window.addEventListener("scroll", keep, { passive: true });
})();
