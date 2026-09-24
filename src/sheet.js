// ?sheet: every sprite enlarged on one page, for checking art.
import { ENEMIES } from "./content.js";
import { mechFrames, enemyFrames, salvageFrames, bigSalvageFrames, glow, MECH_KINDS } from "./art.js";

export function drawSheet(canvas) {
  const Z = +new URLSearchParams(location.search).get("z") || 8;
  const rows = [
    ...MECH_KINDS.flatMap((k) => [[k, mechFrames(k, false)], [k + " hot", [mechFrames(k, true, 0)[0], mechFrames(k, true, 1)[2]]]]),
    ...Object.keys(ENEMIES).map((k) => [k, enemyFrames(k)]),
    ["salvage", [...salvageFrames(), ...bigSalvageFrames()]],
    ["glow", [glow(12, "#1f5a73"), glow(8, "#5a2410")]],
  ];
  canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio;
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#1c1f26"; g.fillRect(0, 0, canvas.width, canvas.height);
  let y = 10;
  g.font = "14px monospace";
  for (const [name, frames] of rows) {
    g.fillStyle = "#8d95a1"; g.fillText(name, 10, y + 14);
    let x = 110, h = 0;
    for (const f of frames) {
      g.fillStyle = "#262a33"; g.fillRect(x - 2, y - 2, f.width * Z + 4, f.height * Z + 4);
      g.drawImage(f, x, y, f.width * Z, f.height * Z);
      x += f.width * Z + 16; h = Math.max(h, f.height * Z);
    }
    y += h + 16;
  }
}
