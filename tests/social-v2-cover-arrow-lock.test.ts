import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';

/**
 * Arrow-position lock (2026-09-29 late second pass). Tommy's rule: the
 * cover chevron stays exactly where it is in the design-v1 reference
 * fixtures (`runs/design-v1-fixture-{no,with}-photos/preview/slide-00.png`).
 * This test reads the current preview.css and asserts the chevron
 * coordinates + glyph size match the values baked into those fixtures.
 * If any of them moves, this test fails and the fixtures need to be
 * renewed with an explicit decision.
 */
describe('cover chevron position locked from design-v1 fixture', () => {
  const cssPath = path.resolve(__dirname, '../app/social/render/preview/preview.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  function block(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`selector ${selector} not found in preview.css`);
    const end = css.indexOf('}', start);
    return css.slice(start, end);
  }

  test('.helios-cover__chevron: right = 96px', () => {
    assert.match(block('.helios-cover__chevron'), /right:\s*96px/);
  });

  test('.helios-cover__chevron: bottom = 60px', () => {
    assert.match(block('.helios-cover__chevron'), /bottom:\s*60px/);
  });

  test('.helios-cover__chevron: font-size = 60px', () => {
    assert.match(block('.helios-cover__chevron'), /font-size:\s*60px/);
  });

  test('.helios-cover__chevron: position = absolute', () => {
    assert.match(block('.helios-cover__chevron'), /position:\s*absolute/);
  });

  test('.helios-cover__chevron: color uses brand-orange var', () => {
    assert.match(block('.helios-cover__chevron'), /color:\s*var\(--brand-orange\)/);
  });
});
