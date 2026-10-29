import { test } from 'node:test';
import assert from 'node:assert/strict';

test('4.2 animals: puppy, songbird and horse draw in side and front, never as critters', async () => {
  const { animal, ANIMALS, ANIMAL_PARTS, animalFrom } = await import('../explainers/world-kit/animals.js');
  assert.deepEqual(Object.keys(ANIMALS), ['puppy', 'songbird', 'horse']);
  for (const kind of Object.keys(ANIMALS)) {
    for (const view of ['side', 'front']) {
      for (const t of [0, 1, 2.4]) {
        const svg = animal(kind, 540, 1400, { view, t, action: true });
        assert.match(svg, new RegExp(`data-animal="${kind}"`));
        assert.doesNotMatch(svg, /data-who=|NaN|undefined/, `${kind} ${view} at ${t}s`);
      }
    }
    // flip mirrors the geometry only
    assert.notEqual(animal(kind, 540, 1400, { flip: true }), animal(kind, 540, 1400));
  }
  assert.throws(() => animal('dragon', 0, 0), /unknown kind/);
  assert.throws(() => animal('puppy', 0, 0, { view: 'back' }), /view must be/);
  // a horse stands taller than a puppy at the same scale (true scale on the critter ruler)
  const scaleOf = (svg: string) => Number(/scale\(([\d.]+)\)/.exec(svg)![1]);
  assert.ok(scaleOf(animal('horse', 0, 0)) * ANIMALS.horse.units > scaleOf(animal('puppy', 0, 0)) * ANIMALS.puppy.units);
  // another species composed from the same parts
  const cat = (animalFrom as any)(() => ANIMAL_PARTS.shadow(0, 0, 60, 8) + ANIMAL_PARTS.vol(ANIMAL_PARTS.ell(0, -60, 70, 40), '#888888') + ANIMAL_PARTS.bead(50, -90, 6), 300, 900, { kind: 'cat', cm: 25, units: 120 });
  assert.match(cat, /data-animal="cat"/);
});
