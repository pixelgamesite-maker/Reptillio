/**
 * Every media asset in one place. When real art lands (transparent PNGs of
 * each reptile form, card art), change the paths here — nothing else.
 */
export const ASSETS = {
  items: {
    genesis_egg: "/items/genesis-egg.jpg",
    vitality_extract: "/items/vitality-extract.jpg",
    dna_capsule: "/items/dna-capsule.jpg",
    ancient_scale: "/items/ancient-scale.jpg",
    mutation_core: "/items/mutation-core.jpg",
    evolution_catalyst: "/items/evolution-catalyst.jpg",
  } as Record<string, string>,

  /**
   * Optional final art for each reptile form (index 0 = Level 1). Leave an
   * entry null to use the built-in SVG placeholder for that level. Level 1
   * uses the Genesis Egg image. Transparent PNG/WebP, roughly square.
   */
  reptiles: [null, null, null, null, null, null] as (string | null)[],

  sounds: {
    select: "/sounds/select.mp3",
    levelup: "/sounds/levelup.mp3",
  },
};

export const LINKS = {
  x: "https://x.com/REPTILIO_HANDLE", // ⚠️ replace with the real account
  site: typeof window !== "undefined" ? window.location.origin : "https://reptilio.fun",
};
