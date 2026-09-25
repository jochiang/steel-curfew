# Steel Curfew

A Brotato-like mech shooter in a procedural, destructible city. Survive five waves as the day wears into night, spend salvage in the hangar between them, and take down the boss in the dark.

**Play:** https://jochiang.github.io/steel-curfew/ (phone or desktop)

- Move with WASD / arrows, or touch and drag anywhere. Weapons aim and fire on their own.
- Energy weapons share one capacitor: when it fills they all discharge together, then the mech vents and every weapon goes offline for a moment.
- Four frames with typed hardpoints, nine weapons that merge up to tier IV, pilot level-ups, unlocks that carry between runs.
- Buildings block shots and paths, and they fall down. The city keeps its damage for the whole run.

Everything is drawn and synthesized in code: text-authored pixel art on Canvas2D, music and sound through Web Audio. No engine, no assets besides the font.

## Develop

```sh
npm install
npm run dev      # http://127.0.0.1:5391
npm run build    # static build in dist/
```

Balance tools (Node, no browser): `node tools/sim.mjs`, `node tools/balance.mjs`, `node tools/pressure.mjs`, `node tools/fuzz.mjs`.

## License

MIT. The Pixelify Sans font is under the SIL Open Font License.
