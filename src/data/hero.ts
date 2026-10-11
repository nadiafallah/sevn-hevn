/**
 * The piece introduced in the homepage hero. `ref` points at a catalogue item (its name, tagline and
 * link come from there, in every language); `cutout` is the same photograph with its background
 * removed, so the piece can be placed on the hero's stage.
 *
 * To feature a real piece: add a transparent PNG/WebP of its own photograph to public/images/hero/,
 * record its source in ASSETS.md, then change both fields. Set `editorial: false` for a real item.
 */
export const heroPiece = {
  ref: "ED-COGNAC",
  editorial: true,
  cutout: { src: "/images/hero/bag-cognac-cutout.png", width: 791, height: 805 },
} as const;
