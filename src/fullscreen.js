// Fullscreen where the browser allows it. iPhone Safari doesn't expose the Fullscreen API to
// pages at all; there the way in is "Add to Home Screen" (the manifest makes that launch
// without browser chrome), so the UI shows a tip instead of a button.

const el = document.documentElement;
export const supported = () => !!(el.requestFullscreen || el.webkitRequestFullscreen) && (document.fullscreenEnabled ?? document.webkitFullscreenEnabled ?? true);
export const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
// launched from the home screen (display-mode also reads "fullscreen" during API fullscreen, so rule that out)
export const standalone = () => navigator.standalone === true || (!isFull() && matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches);
export const isIOS = () => /iP(hone|od|ad)/.test(navigator.platform) || (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1);

export async function toggle() {
  try {
    if (isFull()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else await (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: "hide" });
  } catch { /* refused (e.g. not from a tap); nothing to do */ }
}

/** Keep every [data-fs] button's icon and label in sync with the current state */
export function syncButtons() {
  for (const b of document.querySelectorAll("[data-fs]")) {
    b.hidden = !supported() || standalone();
    b.classList.toggle("on", isFull());
    b.setAttribute("aria-label", isFull() ? "Exit fullscreen" : "Fullscreen");
    b.title = isFull() ? "Exit fullscreen (F)" : "Fullscreen (F)";
  }
}
for (const ev of ["fullscreenchange", "webkitfullscreenchange"]) document.addEventListener(ev, syncButtons);
