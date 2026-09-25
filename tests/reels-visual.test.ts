/**
 * Offline tests for the reel visual pipeline. No Claude and no image API:
 * the scene writer and the image call are stubbed, and the text engine runs
 * locally.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { VISUAL_IMAGE_SIZE } from '@/lib/reels/config';
import { assembleImagePrompt, referenceBlocks, sceneWriterInstructions } from '@/lib/reels/visual/blocks';
import { checkBackgroundPng, renderTextPng } from '@/lib/reels/visual/engine';
import { priceImageUsage } from '@/lib/reels/visual/image';
import { FALLBACK_SCENE, produceFrame } from '@/lib/reels/visual/produce';
import { frameSignedUrl, isRetryableUploadStatus } from '@/lib/reels/visual/storage';
import { buildStory, parseScene, visualCategory, type VisualMember } from '@/lib/reels/visual/scene';

const root = path.resolve(__dirname, '..');
const python = path.join(root, 'helios_text_engine/.venv/bin/python');

function member(overrides: Partial<VisualMember> = {}): VisualMember {
  return {
    role: 'primary',
    sourceName: 'TechCrunch',
    headline: 'Nvidia crossed four trillion',
    body: 'The chip maker passed the mark on a Monday. ' + 'word '.repeat(20),
    sourceBucket: 'B',
    ...overrides,
  };
}

test('the image prompt and the scene writer share one master copy of the fixed blocks', () => {
  const master = readFileSync(path.join(root, 'lib/reels/visual/fixed-style-blocks.txt'), 'utf8').replace(/\s+$/, '');
  const scene = 'A single matte pedestal sits in the lower zone, with one orange seam.';
  const image = assembleImagePrompt(scene);
  assert.equal(image, master.replace('{insert scene description here}', scene));
  assert.equal(image.includes('{insert scene description here}'), false);

  const reference = referenceBlocks();
  const avoidAt = reference.indexOf('\n\n[AVOID]');
  assert.ok(avoidAt > 0);
  assert.ok(image.startsWith(reference.slice(0, avoidAt)));
  assert.ok(image.endsWith(reference.slice(avoidAt + 2)));

  const promptFile = readFileSync(path.join(root, 'lib/reels/visual/scene-writer-prompt.txt'), 'utf8').replace(
    /\s+$/,
    '',
  );
  const instructions = sceneWriterInstructions();
  assert.ok(instructions.includes(reference));
  assert.equal(instructions.includes('[Pulled from the master copy'), false);
  assert.ok(instructions.startsWith(promptFile.slice(0, 20)));
  assert.ok(instructions.includes('ROLE'));
  assert.ok(instructions.includes('Monolith processor'));
});

test('the three-zone prompt is saved, and the live prompt asks for one scene', () => {
  const savedStyle = readFileSync(
    path.join(root, 'lib/reels/visual/saved/three-zone-v1/fixed-style-blocks.txt'),
    'utf8',
  );
  const savedWriter = readFileSync(
    path.join(root, 'lib/reels/visual/saved/three-zone-v1/scene-writer-prompt.txt'),
    'utf8',
  );
  assert.match(savedStyle, /upper portion of the frame/);
  assert.match(savedWriter, /UPPER zone or the LOWER zone/);

  const liveStyle = readFileSync(path.join(root, 'lib/reels/visual/fixed-style-blocks.txt'), 'utf8');
  const liveWriter = readFileSync(path.join(root, 'lib/reels/visual/scene-writer-prompt.txt'), 'utf8');
  assert.match(liveStyle, /One continuous scene/);
  assert.doesNotMatch(liveStyle, /upper portion of the frame/);
  assert.match(liveWriter, /one cohesive scene/i);
  assert.doesNotMatch(liveWriter, /UPPER zone/);
  assert.match(sceneWriterInstructions(), /One continuous scene/);
  assert.match(sceneWriterInstructions('paper'), /85% of the frame is white/);
  assert.match(liveWriter, /When the blocks are the white field, keep the\s+place bright/);
  assert.match(liveWriter, /moves into darkness/);
  assert.match(liveWriter, /When the fixed blocks are\s+the dark room/);
  assert.doesNotMatch(liveWriter, /move it into darkness/);
  assert.match(sceneWriterInstructions('orange'), /80% of the frame is flat vivid orange/);
  assert.match(assembleImagePrompt('A desk.', 'orange'), /A desk\./);
  assert.match(assembleImagePrompt('A desk.', 'orange'), /#FF5E1A/);
});

test('category follows the content bucket, then the primary source bucket', () => {
  assert.equal(visualCategory('the_saga', 'A'), 'storytelling');
  assert.equal(visualCategory('personal_profile', 'A'), 'storytelling');
  assert.equal(visualCategory('the_number', 'B'), 'education');
  assert.equal(visualCategory('ball_knowledge', null), 'education');
  assert.equal(visualCategory(null, 'B'), 'storytelling');
  assert.equal(visualCategory(null, 'A'), 'education');
  assert.equal(visualCategory(null, null), 'education');
});

test('the story is the caption plus source excerpts, and a merged duplicate is the headline only', () => {
  const story = buildStory('The board fired him on Friday.', [
    member(),
    member({ role: 'merged_duplicate', headline: 'Same story, shorter wire', body: 'should not appear' }),
  ]);
  assert.ok(story.startsWith('The board fired him on Friday.'));
  assert.ok(story.includes('Nvidia crossed four trillion'));
  assert.ok(story.includes('Same story, shorter wire'));
  assert.equal(story.includes('should not appear'), false);
});

test('parseScene keeps the prose and drops a fence or a scene label', () => {
  assert.equal(parseScene('A desk in the dark.'), 'A desk in the dark.');
  assert.equal(parseScene('```\nA desk in the dark.\n```'), 'A desk in the dark.');
  assert.equal(parseScene('[SCENE — VARIABLE]\nA desk in the dark.'), 'A desk in the dark.');
  assert.throws(() => parseScene('   '), /empty/);
});

test('gpt-image-2 size is exact 9:16 inside the model limits', () => {
  const [width, height] = VISUAL_IMAGE_SIZE.split('x').map(Number);
  assert.equal(width * 16, height * 9);
  assert.equal(width % 16, 0);
  assert.equal(height % 16, 0);
  const pixels = width * height;
  assert.ok(pixels >= 655_360 && pixels <= 8_294_400);
  assert.ok(pixels <= 3_686_400);
});

test('image usage prices text input and image output separately', () => {
  const usd = priceImageUsage({ textInputTokens: 1_000, imageInputTokens: 0, imageOutputTokens: 5_500 });
  assert.equal(usd, 1_000 * 5 / 1_000_000 + 5_500 * 30 / 1_000_000);
});

test('produceFrame fails open on a bad scene, a bright band, or copy that does not fit', async () => {
  const input = {
    story: 'A founder lost the company on Friday.',
    category: 'storytelling' as const,
    onScreenText: 'The board fired him Friday.',
    recentScenes: [],
  };
  const png = Buffer.from('png');

  const failed = await produceFrame(input, {
    writeScene: async () => ({ scene: null, message: null, error: 'no text' }),
    generateBackground: async () => ({ png, usage: { textInputTokens: 1, imageInputTokens: 0, imageOutputTokens: 2, usd: 0.01 } }),
    checkBackground: async () => ({ pass: true, reasons: [], mean_luma: 0.02, bright_fraction: 0, width: 1152, height: 2048 }),
    renderText: async () => ({ ok: true, rendered: { png, lines: ['The board fired him Friday.'], warnings: [] } }),
  });
  assert.equal(failed.status, 'ok');
  assert.equal(failed.scene, FALLBACK_SCENE);
  assert.match(failed.warnings.join(' '), /Scene writer failed \(no text\)/);

  let rendered = false;
  const rejected = await produceFrame(input, {
    writeScene: async () => ({ scene: 'A figure in the lower zone.', message: null, error: null }),
    generateBackground: async () => ({ png, usage: { textInputTokens: 1, imageInputTokens: 0, imageOutputTokens: 2, usd: 0.01 } }),
    checkBackground: async () => ({
      pass: false,
      reasons: ['mean luma 0.400 > 0.12'],
      mean_luma: 0.4,
      bright_fraction: 0,
      width: 1152,
      height: 2048,
    }),
    renderText: async () => {
      rendered = true;
      return { ok: true, rendered: { png, lines: ['x'], warnings: [] } };
    },
  });
  assert.equal(rejected.status, 'ok');
  assert.equal(rendered, true);
  assert.match(rejected.warnings.join(' '), /mean luma 0\.400 > 0\.12/);
  assert.equal(rejected.imagePrompt?.includes('A figure in the lower zone.'), true);
  assert.equal(rejected.imagePrompt?.includes('[STYLE — FIXED, DO NOT ALTER]'), true);

  const unfit = await produceFrame(input, {
    writeScene: async () => ({ scene: 'A figure in the lower zone.', message: null, error: null }),
    generateBackground: async () => ({ png, usage: { textInputTokens: 1, imageInputTokens: 0, imageOutputTokens: 2, usd: 0.01 } }),
    checkBackground: async () => ({
      pass: true,
      reasons: [],
      mean_luma: 0.02,
      bright_fraction: 0,
      width: 1152,
      height: 2048,
    }),
    renderText: async () => ({ ok: false, error: 'too long', details: { copy_chars: 400 } }),
  });
  assert.equal(unfit.status, 'ok');
  assert.equal(unfit.frame, png);
  assert.match(unfit.warnings.join(' '), /Copy did not fit the still \(too long\)/);
  assert.ok(unfit.background);
});

test('the text engine keeps a short break and fits longer copy on the frame', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'helios-visual-'));
  const dark = path.join(dir, 'dark.png');
  const bright = path.join(dir, 'bright.png');
  execFileSync(python, [
    '-c',
    `from PIL import Image
Image.new('RGB', (1152, 2048), (8, 8, 8)).save(${JSON.stringify(dark)})
Image.new('RGB', (1152, 2048), (240, 240, 240)).save(${JSON.stringify(bright)})`,
  ]);
  const darkPng = readFileSync(dark);
  const darkQa = await checkBackgroundPng(darkPng);
  assert.equal(darkQa.pass, true);
  assert.equal(darkQa.width, 1152);
  assert.equal(darkQa.height, 2048);

  const brightQa = await checkBackgroundPng(readFileSync(bright));
  assert.equal(brightQa.pass, false);
  const paperQa = await checkBackgroundPng(readFileSync(bright), 'paper');
  assert.equal(paperQa.pass, true);
  const orange = path.join(dir, 'orange.png');
  execFileSync(python, [
    '-c',
    `from PIL import Image
Image.new('RGB', (1152, 2048), (255, 94, 26)).save(${JSON.stringify(orange)})`,
  ]);
  const orangeQa = await checkBackgroundPng(readFileSync(orange), 'orange');
  assert.equal(orangeQa.pass, true);
  assert.equal((await checkBackgroundPng(darkPng, 'orange')).pass, false);

  const rendered = await renderTextPng(darkPng, 'Nvidia just passed $4 trillion.');
  assert.equal(rendered.ok, true);
  if (rendered.ok) {
    assert.deepEqual(rendered.rendered.lines, ['Nvidia just passed', '$4 trillion.']);
    assert.equal(rendered.rendered.png.length > 1000, true);
  }

  const longCopy = [
    'A small team replaced the bowling alley computer with a handful of chips and the nightly books still closed.',
    'The old system had cost six figures.',
    'The new one cost about as much as a used car, and the staff learned it in an afternoon.',
  ].join(' ');
  const fitted = await renderTextPng(darkPng, longCopy);
  assert.equal(fitted.ok, true);
  if (fitted.ok) {
    assert.deepEqual(fitted.rendered.lines.join(' ').split(/\s+/), longCopy.split(/\s+/));
    assert.equal(fitted.rendered.lines.length > 2, true);
    assert.equal(fitted.rendered.warnings.some((warning) => warning.startsWith('Type set at')), true);
    assert.equal(fitted.rendered.png.length > 1000, true);
  }

  const wide = await renderTextPng(darkPng, 'ThisWordIsWayTooLongForOneLine');
  assert.equal(wide.ok, true);
  if (wide.ok) {
    assert.deepEqual(wide.rendered.lines, ['ThisWordIsWayTooLongForOneLine']);
  }

  const tooLong = Array.from({ length: 40 }, (_, index) => `Sentence number ${index + 1} keeps going past the band.`).join(' ');
  const clipped = await renderTextPng(darkPng, tooLong);
  assert.equal(clipped.ok, true);
  if (clipped.ok) {
    const drawn = clipped.rendered.lines.join(' ');
    assert.equal(drawn.startsWith('Sentence number 1'), true);
    assert.equal(drawn.includes('Sentence number 40'), false);
    assert.equal(
      clipped.rendered.warnings.some((warning) => warning.includes('not on this still')),
      true,
    );
    assert.equal(
      clipped.rendered.warnings.some((warning) => warning.includes('under the preferred minimum')),
      false,
    );
  }
});

test('one frame gets the whole on-screen copy, and a storage timeout is retried', async () => {
  const copy = [
    "Meta's Muse has a zero-day. Any local app or terminal command can take full control of the agent.",
    'To work, Muse needs mic, camera, location, calendar, and broad file access.',
    'Amazon started blocking Muse from its own site on Sunday.',
  ].join('\n\n');

  let received = '';
  const frame = await produceFrame(
    {
      story: 'A local app can take the agent over.',
      category: 'storytelling',
      onScreenText: copy,
      recentScenes: [],
    },
    {
      writeScene: async () => ({ scene: 'A dark desk in the lower zone.', message: null, error: null }),
      generateBackground: async () => ({
        png: Buffer.from('png'),
        usage: { textInputTokens: 1, imageInputTokens: 0, imageOutputTokens: 2, usd: 0.01 },
      }),
      checkBackground: async () => ({
        pass: true,
        reasons: [],
        mean_luma: 0.02,
        bright_fraction: 0,
        width: 1152,
        height: 2048,
      }),
      renderText: async (_png, text) => {
        received = text;
        return {
          ok: true,
          rendered: { png: Buffer.from('frame'), lines: ['Meta\'s Muse has a zero-day.'], warnings: [] },
        };
      },
    },
  );
  assert.equal(received, copy);
  assert.equal(frame.status, 'ok');
  assert.equal(frame.warnings.some((warning) => warning.includes('screen 1 of')), false);

  assert.equal(isRetryableUploadStatus(504), true);
  assert.equal(isRetryableUploadStatus(502), true);
  assert.equal(isRetryableUploadStatus(400), false);

  const base = 'https://example.supabase.co';
  const signed = frameSignedUrl(base, '/object/sign/reels-frames/job/background.png?token=abc');
  assert.equal(signed, `${base}/storage/v1/object/sign/reels-frames/job/background.png?token=abc`);
});
