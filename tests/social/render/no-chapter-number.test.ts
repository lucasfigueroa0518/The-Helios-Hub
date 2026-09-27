import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'fs';
import { join } from 'path';

test('SlideTemplate — chapter number CSS class removed', () => {
  const templatePath = join(process.cwd(), 'lib/social/render/SlideTemplate.tsx');
  const cssPath = join(process.cwd(), 'app/social/render/preview/preview.css');

  const templateContent = readFileSync(templatePath, 'utf-8');
  const cssContent = readFileSync(cssPath, 'utf-8');

  assert.ok(
    !templateContent.includes('helios-beat__chapter'),
    'SlideTemplate.tsx should not contain helios-beat__chapter class reference'
  );
  assert.ok(
    !cssContent.includes('helios-beat__chapter'),
    'preview.css should not contain helios-beat__chapter CSS rule'
  );
  assert.ok(
    !templateContent.includes('showChapter'),
    'SlideTemplate.tsx should not contain showChapter variable'
  );
  assert.ok(
    !templateContent.includes('chapterNumber'),
    'SlideTemplate.tsx should not contain chapterNumber variable'
  );
});
