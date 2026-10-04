/**
 * Cross-carousel photo uniqueness ledger.
 *
 * Every source-file URL that has appeared as a `photoUrl` in a published
 * Helios Social fixture is listed here. The skill rule (see
 * `~/.claude/skills/helios-social-design/SKILL.md` § Photo policy) is:
 *
 *   "No cross-carousel photo reuse — once a source file ships in a
 *    published post, it comes off the roster."
 *
 * When authoring a new fixture, run `assertPhotosUnused()` on the fixture's
 * photo URLs before adding the fixture to the FIXTURES record. If any URL
 * is already in USED_PHOTOS the assertion throws, forcing the author to
 * source a different photo.
 *
 * The ledger records who used the photo and when so we can grow the
 * library deliberately rather than by accident.
 */

export type UsedPhoto = {
  url: string;
  usedIn: string; // fixture key (e.g. "openai-sol")
  slidePosition: number; // which slide of that fixture
  subject: string; // human name or metaphor description
  license: string; // short-form license line
};

export const USED_PHOTOS: readonly UsedPhoto[] = [
  {
    url: '/social/dario-amodei.jpg',
    usedIn: 'example-post',
    slidePosition: 0,
    subject: 'Dario Amodei (Anthropic CEO)',
    license: 'Wikimedia Commons, CC BY-SA 4.0',
  },
  {
    url: '/social/julie-sweet.jpg',
    usedIn: 'example-post',
    slidePosition: 3,
    subject: 'Julie Sweet (Accenture CEO)',
    license: 'Wikimedia Commons, CC BY-SA 4.0',
  },
  {
    url: '/social/accenture-hero.jpg',
    usedIn: 'example-post',
    slidePosition: 1,
    subject: 'Anthropic + Accenture announcement hero',
    license: 'Anthropic (press-provided)',
  },
  {
    url: '/social/sam-altman.jpg',
    usedIn: 'openai-sol',
    slidePosition: 0,
    subject: 'Sam Altman (OpenAI CEO)',
    license: 'Wikimedia Commons, CC BY-SA 4.0',
  },
  {
    url: '/social/openai-hero.jpg',
    usedIn: 'openai-sol',
    slidePosition: 1,
    subject: 'OpenAI SF HQ',
    license: 'Wikimedia Commons, CC BY-SA 4.0',
  },
  {
    url: '/social/alignment-security.png',
    usedIn: 'claude-hacks-openai',
    slidePosition: 1,
    subject: 'Anthropic alignment/security illustration',
    license: 'Anthropic (press-provided)',
  },
  {
    url: '/social/enterprise-safeguards.png',
    usedIn: 'claude-hacks-openai',
    slidePosition: 3,
    subject: 'Anthropic enterprise safeguards illustration',
    license: 'Anthropic (press-provided)',
  },
  {
    url: '/social/stock/mustafa-suleyman.jpg',
    usedIn: 'suleyman-containment',
    slidePosition: 0,
    subject: 'Mustafa Suleyman (Microsoft AI CEO)',
    license: 'Wikimedia Commons, CC BY-SA 4.0',
  },
  {
    url: '/social/stock/circuit-macro.jpg',
    usedIn: 'suleyman-containment',
    slidePosition: 1,
    subject: 'Circuit-board macro (metaphor)',
    license: 'Unsplash',
  },
  {
    url: '/social/stock/dell-keyboard.jpg',
    usedIn: 'suleyman-containment',
    slidePosition: 3,
    subject: 'Hands on laptop keyboard (metaphor)',
    license: 'Unsplash',
  },
  {
    url: '/social/stock/newspapers-stack.jpg',
    usedIn: 'ai-safety-explosive',
    slidePosition: 0,
    subject: 'Stack of newspapers with "WORLD BUSINESS" (metaphor)',
    license: 'Unsplash',
  },
  {
    url: '/social/stock/typewriter-ml.jpg',
    usedIn: 'ai-safety-explosive',
    slidePosition: 1,
    subject: 'Typewriter with "MACHINE LEARNING" on paper (metaphor)',
    license: 'Unsplash',
  },
  {
    url: '/social/stock/server-racks.jpg',
    usedIn: 'ai-safety-explosive',
    slidePosition: 2,
    subject: 'Server racks with LEDs (metaphor)',
    license: 'Unsplash',
  },
  {
    url: '/social/stock/dashboard.jpg',
    usedIn: 'ai-safety-explosive',
    slidePosition: 3,
    subject: 'Analytics dashboard on screen (metaphor)',
    license: 'Unsplash',
  },
  {
    url: '/social/stock/demis-hassabis.jpg',
    usedIn: 'deepmind-agi-institute',
    slidePosition: 0,
    subject: 'Demis Hassabis (Google DeepMind CEO)',
    license: 'Wikimedia Commons, CC BY-SA 4.0',
  },
  {
    url: '/social/stock/circuit-schematic.jpg',
    usedIn: 'deepmind-agi-institute',
    slidePosition: 1,
    subject: 'Glowing circuit schematic (metaphor)',
    license: 'Unsplash',
  },
  {
    url: '/social/stock/macbook-glow.jpg',
    usedIn: 'deepmind-agi-institute',
    slidePosition: 3,
    subject: 'MacBook glowing at night (metaphor)',
    license: 'Unsplash',
  },
  // earth-from-space.jpg was previously used on the deepmind-agi-institute
  // source slide (position 4). That slide was retired when the Source
  // archetype was dropped. Photo is now available again for future fixtures.
] as const;

/**
 * Fast lookup: photo URL → the fixture that already burned it.
 */
export const USED_PHOTO_URLS: ReadonlySet<string> = new Set(
  USED_PHOTOS.map((p) => p.url),
);

/**
 * Assert that none of the given URLs already appear in USED_PHOTOS.
 * Throws with a helpful message naming the offending fixture(s).
 *
 * Call this from every new fixture module before it exports its Post
 * into the FIXTURES record. If it throws, source a different photo —
 * do NOT delete the ledger entry to make the check pass.
 */
export function assertPhotosUnused(
  urls: readonly string[],
  fixtureKey: string,
): void {
  // Only flag as a collision if the URL is claimed by a DIFFERENT
  // fixture. A fixture's own photos re-appear in the ledger after
  // first ship, so filtering by fixtureKey lets the module keep
  // importing without an infinite self-collision.
  const collisions = urls
    .filter((u) => {
      if (!u) return false;
      const prior = USED_PHOTOS.find((p) => p.url === u);
      return Boolean(prior && prior.usedIn !== fixtureKey);
    })
    .map((u) => {
      const prior = USED_PHOTOS.find((p) => p.url === u)!;
      return `  - ${u}\n    already used in "${prior.usedIn}" (slide ${prior.slidePosition}, ${prior.subject})`;
    });
  if (collisions.length > 0) {
    throw new Error(
      `[helios-social] Fixture "${fixtureKey}" tried to reuse `
        + `${collisions.length} photo${collisions.length === 1 ? '' : 's'} `
        + `already published in prior fixtures:\n${collisions.join('\n')}\n`
        + `Source a fresh photo (Wikimedia has 3–8 press portraits per public `
        + `figure; Unsplash / Pexels have unlimited metaphor imagery). Do NOT `
        + `remove entries from USED_PHOTOS to bypass this check.`,
    );
  }
}
