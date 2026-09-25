import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { extractJobId, extractVideoUrl } from '@/lib/reels/visual/higgsfield/client';
import { falErrorText, falKlingBody } from '@/lib/reels/visual/kling/api';
import { klingArguments, pickKlingTool, type McpTool } from '@/lib/reels/visual/higgsfield/kling';
import { newestLogin, storeLogin, usableAccessToken } from '@/lib/reels/visual/higgsfield/session';
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';

import { COLOR_ROUTE } from '@/lib/reels/jev/questions/color-route';
import { HOOK_ROUTE, HOOK_ROUTE_OPTIONS } from '@/lib/reels/jev/questions/hook-route';
import type { JevRequest, JevRunner } from '@/lib/reels/jev/runner';
import { HOOKS, hookFilter, hookFrames, pickHookTiming, timingSpanFrames } from '@/lib/reels/visual/hook';
import { routeColor } from '@/lib/reels/visual/color-route';
import { COLOR_PROFILES } from '@/lib/reels/visual/color';
import { routeHook } from '@/lib/reels/visual/hook-route';
import {
  BAND_HOLD,
  MOTION_PROMPT_VERSION,
  buildMotionUser,
  motionGradeInstructions,
  motionRecord,
  motionWriterInstructions,
  parseMotionPrompt,
} from '@/lib/reels/visual/motion-prompt';
import { SUBMIT_MOTION_TOOL, motionSystem, writeMotion, type MotionClient } from '@/lib/reels/visual/motion-writer';

const CAMERA = 'Camera: slow dolly in, already moving on the first frame, easing gradually and coming to rest by 6.0s.';
const SPANS = `0.0-0.5s: The haze in the upper beam is already drifting left at an easy pace.
0.5-2.0s: The haze keeps drifting and slowing; the orange light at the top holds low and steady.
2.0-3.5s: The orange light dips a touch, then the lock at the top releases in one slow turn.
3.5-8.0s: The orange light swells quickly and settles slowly to a steady glow; the haze drifts on and settles last.`;
const GOOD = `${CAMERA}\n${SPANS}`;

const KLING = parseMotionPrompt(GOOD, 'noir').text;
const PLAN = 'The dolly eases in and rests; the orange light gathers into the beat and settles; the haze flows one way and settles last.';

describe('motion prompt', () => {
  it('keeps the system prompt ironclad and identical', () => {
    const text = motionWriterInstructions();
    assert.match(text, /Kling 3\.0/);
    assert.match(text, /0\.0-0\.5s/);
    assert.match(text, /ON_SCREEN_COPY/);
    assert.match(text, /sound off/i);
    assert.match(text, /never name or describe it/);
    assert.match(text, /30% to 62%/);
    assert.match(text, /POLARITY/);
    assert.match(text, /speed curve/);
    assert.equal(motionWriterInstructions(), text);
  });

  it('routes one grade block per color profile, after the shared cached instructions', () => {
    for (const profile of COLOR_PROFILES) {
      const block = motionGradeInstructions(profile);
      assert.match(block, new RegExp(`^GRADE: ${profile.toUpperCase()}\\n`));
      assert.match(block, /the band stays/);
      const system = motionSystem(profile);
      assert.equal(system.length, 2);
      assert.equal(system[0]?.text, motionWriterInstructions());
      assert.ok(system[0]?.cache_control);
      assert.equal(system[1]?.text, block);
      assert.equal(system[1]?.cache_control, undefined);
    }
    assert.match(motionGradeInstructions('noir'), /orange light/);
    assert.match(motionGradeInstructions('paper'), /no glow and no haze/);
    assert.match(motionGradeInstructions('orange'), /no glow and no haze/);
  });

  it('accepts a prompt that covers every second and keeps the dolly curve', () => {
    const parsed = parseMotionPrompt(GOOD, 'noir');
    assert.equal(parsed.camera, 'in');
    assert.equal(parsed.cameraCurve, 'already moving on the first frame, easing gradually and coming to rest by 6.0s');
    assert.equal(parsed.spans[0]?.end, 0.5);
    assert.equal(parsed.spans.at(-1)?.end, 8);
    assert.equal(parsed.polarity, null);
  });

  it('sends Kling the camera first, then the band hold for the grade, then the spans', () => {
    for (const profile of COLOR_PROFILES) {
      const lines = parseMotionPrompt(GOOD, profile).text.split('\n');
      assert.equal(lines[0], `${CAMERA.slice(0, -1)}. One continuous shot.`);
      assert.equal(lines[1], BAND_HOLD[profile]);
      assert.match(lines[2] ?? '', /^0\.0-0\.5s: /);
      assert.equal(lines.length, 6);
    }
    assert.doesNotMatch(Object.values(BAND_HOLD).join(' '), /\bno\b|\bnot\b|never|text|caption/i);
  });

  it('moves a trailing camera line to the front and does not double the continuity line', () => {
    const trailing = parseMotionPrompt(`${SPANS}\n${CAMERA.slice(0, -1)}, one continuous shot.`, 'noir');
    assert.equal(trailing.text, KLING);
  });

  it('drops stray hook and polarity lines, and the row stores the hook, version, grade, and plan', () => {
    const parsed = parseMotionPrompt(`Hook: static\nPolarity: ${PLAN}\n${GOOD}`, 'noir');
    assert.equal(parsed.text, KLING);
    assert.doesNotMatch(parsed.text, /Hook:|Polarity:/);
    assert.equal(motionRecord('thermal', parsed), `Hook: thermal\nMotion: ${MOTION_PROMPT_VERSION}, noir\n${KLING}`);
    assert.equal(
      motionRecord('thermal', { ...parsed, polarity: PLAN }),
      `Hook: thermal\nMotion: ${MOTION_PROMPT_VERSION}, noir\nPolarity: ${PLAN}\n${KLING}`,
    );
  });

  it('lets the writer move boundaries after the hook', () => {
    const parsed = parseMotionPrompt(GOOD.replace('0.5-2.0s', '0.5-2.4s').replace('2.0-3.5s', '2.4-3.5s'), 'noir');
    assert.equal(parsed.spans[1]?.end, 2.4);
  });

  it('fails open: structural problems become warnings and Kling still gets a block', () => {
    const cases: [string, RegExp][] = [
      [GOOD.replace('0.5-2.0s', '0.8-2.0s'), /gap or overlap/],
      [GOOD.replace('0.0-0.5s', '0.0-1.0s'), /0\.0-0\.5s/],
      [`${GOOD}\nCamera: slow dolly out, easing away and gathering speed.`, /Extra camera line/],
      [GOOD.replace('slow dolly in', 'slow zoom in'), /not a slow dolly/],
      [`Camera: slow dolly in.\n${SPANS}`, /no speed curve/],
      [`Camera: slow dolly in, easing to a stop, then panning left to the desk.\n${SPANS}`, /second camera move/],
      [SPANS, /Missing camera line/],
      [`${GOOD}\nnot a span`, /was dropped/],
    ];
    for (const [raw, warning] of cases) {
      const parsed = parseMotionPrompt(raw, 'noir');
      assert.match(parsed.warnings.join(' '), warning);
      assert.match(parsed.text, /^Camera: slow dolly (in|out), /);
      assert.equal(parsed.text.split('\n')[1], BAND_HOLD.noir);
    }
    assert.deepEqual(parseMotionPrompt(GOOD, 'noir').warnings, []);
  });

  it('cuts a block too long for Kling and warns', () => {
    const bloated = `${GOOD}\n8.0-8.0s: ${'The haze drifts. '.repeat(160)}`;
    const parsed = parseMotionPrompt(bloated, 'noir');
    assert.ok(parsed.text.length <= 2500);
    assert.match(parsed.warnings.join(' '), /longer than 2500/);
  });

  it('records warnings as labels on the job row', () => {
    const parsed = parseMotionPrompt(SPANS, 'noir');
    assert.match(motionRecord('glitch', parsed), /\nWarning: Missing camera line/);
  });

  it('labels the three inputs and keeps the copy with the writer', () => {
    const user = buildMotionUser({ scene: 'a room', story: 'the source', onScreenCopy: 'the line' });
    assert.match(user, /SCENE\na room/);
    assert.match(user, /STORY\nthe source/);
    assert.match(user, /ON_SCREEN_COPY\nthe line/);
  });
});

describe('motion writer call (stubbed, no API)', () => {
  function stubClient(input: Record<string, unknown>, seen: Anthropic.MessageCreateParamsNonStreaming[]): MotionClient {
    return {
      messages: {
        async create(params) {
          seen.push(params);
          return {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-test',
            content: [{ type: 'tool_use', id: 'toolu_test', name: SUBMIT_MOTION_TOOL, input }],
            stop_reason: 'tool_use',
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as unknown as Anthropic.Message;
        },
      },
    };
  }

  it('routes the grade into the system prompt and keeps the polarity plan out of the Kling text', async () => {
    const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const written = await writeMotion(stubClient({ polarity: `  ${PLAN}\n`, prompt: GOOD }, seen), {
      png: Buffer.from('png'),
      scene: 'a white room',
      story: 'the source',
      onScreenCopy: 'the line',
      profile: 'paper',
    });
    assert.equal(written.error, null);
    assert.equal(written.prompt?.profile, 'paper');
    assert.equal(written.prompt?.polarity, PLAN);
    assert.equal(written.prompt?.text.split('\n')[1], BAND_HOLD.paper);
    assert.doesNotMatch(written.prompt?.text ?? '', /Polarity|gathers into the beat/);
    const params = seen[0];
    assert.deepEqual(params?.system, motionSystem('paper'));
    assert.deepEqual(params?.tool_choice, { type: 'tool', name: SUBMIT_MOTION_TOOL });
    const tool = params?.tools?.[0] as Anthropic.Tool | undefined;
    assert.deepEqual(Object.keys((tool?.input_schema.properties ?? {}) as object), ['polarity', 'prompt']);
    assert.deepEqual(tool?.input_schema.required, ['polarity', 'prompt']);
  });

  it('falls back to a camera-only prompt with a warning when the writer fails', async () => {
    const broken: MotionClient = { messages: { async create() { throw new Error('overloaded'); } } };
    const written = await writeMotion(broken, { png: Buffer.from('png'), scene: 's', story: 't', onScreenCopy: 'c', profile: 'orange' });
    assert.equal(written.error, null);
    assert.match(written.prompt?.warnings[0] ?? '', /Motion writer failed \(overloaded\)/);
    assert.equal(written.prompt?.text.split('\n')[1], BAND_HOLD.orange);
  });
});

describe('Jev hook route', () => {
  it('offers exactly the hooks ffmpeg can stamp', () => {
    assert.deepEqual([...HOOK_ROUTE_OPTIONS].sort(), [...HOOKS].sort());
    assert.ok(HOOKS.length >= 5 && HOOKS.length <= 7);
  });

  it('sends only the on-screen copy and returns the chosen hook', async () => {
    const seen: JevRequest<Questions>[] = [];
    const stub: JevRunner = {
      callCount: 0,
      async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
        seen.push(request as JevRequest<Questions>);
        return {
          model: 'jev-test',
          answers: { hook: { type: 'choice', choice: 'blue_screen', confidence: 0.7, probabilities: {} } },
          usage: { input_tokens: 400, output_tokens: 20 },
        } as unknown as SystemOneResult<Q>;
      },
    };
    const route = await routeHook(stub, { onScreenCopy: '  Google shut down the API overnight.  ', postIdeaId: 'idea-1' });
    assert.equal(route.hook, 'blue_screen');
    assert.equal(route.confidence, 0.7);
    assert.ok(route.usd > 0);
    assert.deepEqual(seen[0]?.state, { on_screen_copy: 'Google shut down the API overnight.' });
    assert.deepEqual(seen[0]?.sets, [HOOK_ROUTE]);
    assert.equal(seen[0]?.postIdeaId, 'idea-1');
  });

  it('refuses a hook ffmpeg cannot stamp', async () => {
    const stub: JevRunner = {
      callCount: 0,
      async ask<const Q extends Questions>(): Promise<SystemOneResult<Q>> {
        return {
          model: 'jev-test',
          answers: { hook: { type: 'choice', choice: 'lock_opens', confidence: 1, probabilities: {} } },
          usage: { input_tokens: 1, output_tokens: 1 },
        } as unknown as SystemOneResult<Q>;
      },
    };
    await assert.rejects(routeHook(stub, { onScreenCopy: 'x', postIdeaId: 'idea-1' }), /unknown hook/);
  });
});

describe('Jev color route', () => {
  it('sends only the on-screen copy and returns the chosen grade', async () => {
    const seen: JevRequest<Questions>[] = [];
    const stub: JevRunner = {
      callCount: 0,
      async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
        seen.push(request as JevRequest<Questions>);
        return {
          model: 'jev-test',
          answers: { color: { type: 'choice', choice: 'orange', confidence: 0.8, probabilities: {} } },
          usage: { input_tokens: 300, output_tokens: 10 },
        } as unknown as SystemOneResult<Q>;
      },
    };
    const route = await routeColor(stub, { onScreenCopy: '  The chip lost half its value.  ', postIdeaId: 'idea-2' });
    assert.equal(route.profile, 'orange');
    assert.deepEqual(seen[0]?.state, { on_screen_copy: 'The chip lost half its value.' });
    assert.deepEqual(seen[0]?.sets, [COLOR_ROUTE]);
    assert.equal(COLOR_ROUTE.version, 'color-route-v2');
    assert.match(JSON.stringify(COLOR_ROUTE), /keeps going after the person looks away/);
  });
});

describe('ffmpeg hook', () => {
  it('covers the pattern window, and the three timings share one chance each', () => {
    assert.equal(hookFrames(24), 12);
    assert.equal(hookFrames(30), 15);
    assert.equal(hookFrames(30000 / 1001), 15);
    assert.deepEqual(timingSpanFrames('double', 30), [6, 3, 6]);
    assert.deepEqual(timingSpanFrames('strobe', 30), [3, 3, 3, 3, 3]);
    assert.deepEqual(timingSpanFrames('tail', 30), [3, 3, 3, 3, 6]);
    assert.equal(hookFrames(30, 'tail'), 18);
    assert.equal(pickHookTiming(() => 0), 'double');
    assert.equal(pickHookTiming(() => 0.34), 'strobe');
    assert.equal(pickHookTiming(() => 0.67), 'tail');
  });

  it('builds a whole-frame chain from the clip to [bg] for every hook', () => {
    for (const hook of HOOKS) {
      const graph = hookFilter(hook, { width: 720, height: 1280, fps: 24 });
      assert.match(graph, /\[0:v\]/);
      assert.match(graph, /\[bg\]$/);
      assert.match(graph, /between\(n\\,0\\,4\)\+between\(n\\,7\\,11\)/);
    }
    const strobe = hookFilter('invert', { width: 720, height: 1280, fps: 30 }, 'strobe');
    assert.match(strobe, /between\(n\\,0\\,2\)\+between\(n\\,6\\,8\)\+between\(n\\,12\\,14\)/);
    const tail = hookFilter('invert', { width: 720, height: 1280, fps: 30 }, 'tail');
    assert.match(tail, /between\(n\\,0\\,2\)\+between\(n\\,6\\,8\)\+between\(n\\,12\\,17\)/);
    assert.match(hookFilter('color_bars', { width: 720, height: 1280, fps: 24 }), /smptehdbars=s=720x1280:r=24/);
    assert.match(hookFilter('blue_screen', { width: 720, height: 1280, fps: 24 }), /color=c=0x0a1ec8:s=720x1280:r=24/);
  });
});

describe('pinned Kling tool', () => {
  const tools: McpTool[] = [
    { name: 'generate_image', description: 'Soul stills' },
    {
      name: 'generate_video',
      description: 'Kling image-to-video',
      inputSchema: {
        properties: {
          prompt: { type: 'string' },
          model: { type: 'string', enum: ['kling-video/v3.0/std/image-to-video', 'veo-3.1'] },
          image_url: { type: 'string' },
          duration: { type: 'number' },
          sound: { type: 'string', enum: ['on', 'off'] },
          multi_shots: { type: 'boolean' },
          enhance_prompt: { type: 'boolean' },
          aspect_ratio: { type: 'string' },
        },
      },
    },
    { name: 'marketing_studio', description: 'Marketing Studio' },
  ];

  it('picks generate_video and forces sound, multi-shot, and enhancement off', () => {
    const tool = pickKlingTool(tools);
    assert.equal(tool.name, 'generate_video');
    const args = klingArguments(tool, { prompt: KLING, imageUrl: 'https://example.com/bg.png' });
    assert.equal(args.model, 'kling-video/v3.0/std/image-to-video');
    assert.equal(args.sound, 'off');
    assert.equal(args.multi_shots, false);
    assert.equal(args.enhance_prompt, false);
    assert.equal(args.duration, 8);
    assert.equal(args.image_url, 'https://example.com/bg.png');
    assert.equal('ON_SCREEN_COPY' in args, false);
  });

  it('sends the motion text inside params when the tool has no flat prompt field', () => {
    const toolsWithDecoy: McpTool[] = [
      {
        name: 'models_explore',
        description: 'Look up Kling image-to-video models',
        inputSchema: { properties: { model_id: { type: 'string' } } },
      },
      {
        name: 'generate_video',
        inputSchema: {
          properties: {
            model: { type: 'string', enum: ['kling3_0', 'seedance_2_0'] },
            params: { type: 'object' },
          },
        },
      },
    ];
    const tool = pickKlingTool(toolsWithDecoy);
    const args = klingArguments(tool, { prompt: KLING, imageUrl: 'https://example.com/bg.png' });
    const params = args.params as { prompt: string; sound: string; multi_shots: boolean; enhance_prompt: boolean; medias: { role: string; value: string }[] };
    assert.equal(args.model, 'kling3_0');
    assert.equal(params.prompt, KLING);
    assert.equal(params.sound, 'off');
    assert.equal(params.multi_shots, false);
    assert.equal(params.enhance_prompt, false);
    assert.equal(params.medias[0]?.role, 'start_image');
    assert.equal(params.medias[0]?.value, 'https://example.com/bg.png');
  });
});

describe('Higgsfield login rotation', () => {
  it('keeps the newer refresh token when the process env is stale', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hf-session-'));
    const session = path.join(dir, 'higgsfield-session.json');
    storeLogin({ clientId: 'client', refreshToken: 'rotated', updatedAt: 200 }, [session]);
    writeFileSync(path.join(dir, 'worker.env'), 'HIGGSFIELD_CLIENT_ID=client\nHIGGSFIELD_REFRESH_TOKEN=stale\nHIGGSFIELD_TOKEN_UPDATED_AT=100\n');
    const login = newestLogin([session, path.join(dir, 'worker.env')], {
      clientId: 'client',
      refreshToken: 'stale',
      updatedAt: 100,
    });
    assert.equal(login?.refreshToken, 'rotated');
  });

  it('reuses a stored access token instead of refreshing again', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hf-session-'));
    const session = path.join(dir, 'higgsfield-session.json');
    const expiresAt = Date.now() + 30 * 60_000;
    storeLogin(
      { clientId: 'client', refreshToken: 'grant', updatedAt: 300, accessToken: 'access', accessExpiresAt: expiresAt },
      [session],
    );
    const login = newestLogin([session], null);
    assert.equal(usableAccessToken(login), 'access');
    assert.equal(usableAccessToken({ ...login!, accessExpiresAt: Date.now() - 1000 }), null);
  });
});

describe('Fal Kling image-to-video body', () => {
  it('pins one 8 second Kling 3 standard clip with audio off', () => {
    const body = falKlingBody({ prompt: '0.0-0.5s: flicker', imageUrl: 'https://example.com/bg.png' });
    assert.equal(body.duration, '8');
    assert.equal(body.generate_audio, false);
    assert.equal(body.start_image_url, 'https://example.com/bg.png');
    assert.equal('multi_prompt' in body, false);
    assert.equal('ON_SCREEN_COPY' in body, false);
  });

  it('reads a Fal download error instead of printing the object', () => {
    const text = falErrorText({
      detail: [{ type: 'file_download_error', msg: 'Failed to download the file. Please check if the URL is accessible and try again.' }],
    });
    assert.equal(text, 'Failed to download the file. Please check if the URL is accessible and try again.');
  });
});

describe('Higgsfield video result', () => {
  it('reads a clip URL and job id out of the tool text', () => {
    const result = {
      content: [{ type: 'text', text: 'Job 8a942b8a-9864-446a-ba7b-58c52330a3e2 ready https://cdn.higgsfield.ai/clips/reel' }],
    };
    assert.equal(extractJobId(result), '8a942b8a-9864-446a-ba7b-58c52330a3e2');
    assert.equal(extractVideoUrl(result), 'https://cdn.higgsfield.ai/clips/reel');
    assert.equal(extractVideoUrl({ url: 'https://cdn.example.com/background.png' }), null);
  });
});
