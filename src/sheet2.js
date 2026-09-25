// ?sheet2: every chassis in every facing, torso over legs, for checking the directional art
import { mechParts, MECH_KINDS } from "./art.js";
export function drawSheet2(canvas) {
  const Z = 7;
  canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio;
  const g = canvas.getContext("2d"); g.imageSmoothingEnabled = false;
  g.fillStyle = "#1c1f26"; g.fillRect(0, 0, canvas.width, canvas.height);
  let y = 10;
  for (const k of MECH_KINDS) {
    const P = mechParts(k, false), H = P.legY + P.legsH + 1;
    let x = 10;
    const views = [["front", P.torso.front, P.legs.front, false], ["back", P.torso.back, P.legs.front, false],
      ["right", P.torso.side, P.legs.side, false], ["left", P.torso.side, P.legs.side, true]];
    for (const [name, torso, legs, flip] of views) for (let f = 0; f < 4; f++) {
      const c = new OffscreenCanvas(P.w, H), cg = c.getContext("2d");
      cg.save(); if (flip) { cg.translate(P.w, 0); cg.scale(-1, 1); }
      cg.drawImage(legs[f], 0, P.legY); cg.drawImage(torso, 0, f === 2 ? 1 : 0);
      cg.restore();
      g.fillStyle = "#262a33"; g.fillRect(x - 2, y - 2, P.w * Z + 4, H * Z + 4);
      g.drawImage(c, x, y, P.w * Z, H * Z);
      x += P.w * Z + (f === 3 ? 26 : 8);
    }
    y += H * Z + 18;
  }
}
