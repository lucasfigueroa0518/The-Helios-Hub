/**
 * The Hub restates Helios design-system tokens in its own CSS: the slide and Stories renderers run in a clean
 * headless browser and load no shared sheet, and the app's UI keeps one tokens block (app/globals.css). This checks
 * every restated value still equals the design system's own (explainers/design/helios-design-system/colors_and_type.css,
 * synced from the source of truth, HELIOS/CODE/helios-design-system, by its scripts/sync.sh). Offline: file reads only.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file: string) => fs.readFileSync(file, 'utf8');

/** `--name: value;` pairs inside the first block whose selector is `selector`. */
function tokensIn(css: string, selector: string): Map<string, string> {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `no "${selector} {" block`);
  const body = css.slice(at, css.indexOf('\n}', at));
  return new Map([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
const norm = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim();

const DS = tokensIn(read('explainers/design/helios-design-system/colors_and_type.css'), ':root');

/** Each restated token and the design-system token it must equal. */
const RESTATED: Array<{ file: string; selector: string; pairs: Array<[string, string]> }> = [
  {
    file: 'app/globals.css',
    selector: ':root',
    pairs: [
      ['--color-bg', '--neutral-50'],
      ['--color-surface', '--neutral-0'],
      ['--color-surface-2', '--neutral-100'],
      ['--color-border', '--neutral-200'],
      ['--color-border-strong', '--neutral-300'],
      ['--color-text', '--neutral-900'],
      ['--color-text-muted', '--neutral-600'],
      ['--color-text-subtle', '--neutral-500'],
      ['--color-primary', '--helios-orange'],
      ['--color-primary-hover', '--accent-hover'],
      ['--color-accent-2', '--helios-green'],
    ],
  },
  {
    file: 'app/social/render/preview/preview.css',
    selector: '.helios-slide',
    pairs: [
      ['--brand-orange', '--helios-orange'],
      ['--brand-green', '--helios-green-on-dark'],
      ['--brand-canvas', '--neutral-950'],
    ],
  },
  {
    file: 'lib/stories/render/stories.css',
    selector: '.st-frame',
    pairs: [
      ['--orange', '--helios-orange'],
      ['--green', '--helios-green'],
      ['--off-black', '--neutral-900'],
      ['--near-black', '--neutral-950'],
    ],
  },
];

for (const { file, selector, pairs } of RESTATED) {
  test(`${file} restates the design system's tokens unchanged`, () => {
    const local = tokensIn(read(file), selector);
    for (const [name, ds] of pairs) {
      assert.ok(DS.has(ds), `design system has no ${ds}`);
      assert.ok(local.has(name), `${file} ${selector} has no ${name}`);
      assert.equal(norm(local.get(name)!), norm(DS.get(ds)!), `${file} ${name} should equal ${ds}`);
    }
  });
}

test('Last Few Days uses the Premium stage values (light touch)', () => {
  const css = read('app/social/render/preview/preview.css');
  const lfd = css.slice(css.indexOf('/* ── Last Few Days'));
  assert.ok(lfd.includes(`linear-gradient(180deg, ${DS.get('--stage-top')} 0%, ${DS.get('--stage-bottom')} 100%)`), 'the LFD ground is the stage gradient');
  assert.match(lfd, new RegExp(`\\.lfd-hook span:last-child \\{ color: ${DS.get('--stage-orange')};`), 'the lit hook line is --stage-orange');
});

test(
  'Stories accent gradient matches the sun',
  { todo: 'Stories --logo-gradient predates the corrected sun values (2026-10-21); changing it changes live Stories frames, so it waits for Lucas' },
  () => {
    const local = tokensIn(read('lib/stories/render/stories.css'), '.st-frame');
    const sun = [DS.get('--helios-sun-top'), DS.get('--helios-sun-mid'), DS.get('--helios-sun-bottom')].map((v) => v!.toLowerCase());
    for (const stop of sun) assert.ok(norm(local.get('--logo-gradient')!).includes(stop));
  },
);
