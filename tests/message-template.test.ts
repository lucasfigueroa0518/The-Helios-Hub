import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  adaptHrefInput,
  assertCustomMessageTemplates,
  composerHtmlToTemplate,
  fillMessageTemplates,
  filledHtmlToComposerHtml,
  filledTemplateToHtml,
  filledTemplateToPlainText,
  isTemplateRefillState,
  parseMessageTemplate,
  parseSubjectTemplate,
  previewMessageTemplates,
  resolveTemplateToken,
  rewriteHrefsInMarkup,
  SAMPLE_TEMPLATE_FIELDS,
  sanitizeHref,
  templateToChipText,
  templateToComposerHtml,
  unmatchedOpenBracketIndex,
} from '@/lib/drafting/message-template';
import { parseAnalyticsMessageMode } from '@/lib/analytics';

test('closed-set tokens resolve aliases case-insensitively', () => {
  assert.equal(resolveTemplateToken('First Name'), 'firstName');
  assert.equal(resolveTemplateToken('FIRST_NAME'), 'firstName');
  assert.equal(resolveTemplateToken('company'), 'company');
  assert.equal(resolveTemplateToken('Position'), 'title');
  assert.equal(resolveTemplateToken('Location'), 'workLocation');
  assert.equal(resolveTemplateToken('unknown field'), null);
});

test('unmatched typed [ is consumed when inserting a variable', () => {
  assert.equal(unmatchedOpenBracketIndex('Hey ['), 4);
  assert.equal(unmatchedOpenBracketIndex('Hey [Comp'), 4);
  assert.equal(unmatchedOpenBracketIndex('Hey [First Name] at ['), 20);
  assert.equal(unmatchedOpenBracketIndex('Hey [First Name]'), -1);
  assert.equal(unmatchedOpenBracketIndex(''), -1);
});

test('unknown brackets fail template parse', () => {
  const parsed = parseMessageTemplate('Hello [Nickname]');
  assert.equal(parsed.errors[0]?.code, 'unknown_variable');
});

test('javascript links are rejected', () => {
  assert.equal(sanitizeHref('javascript:alert(1)'), null);
  assert.equal(sanitizeHref('https://heliosgroup.ai/deck'), 'https://heliosgroup.ai/deck');
  const parsed = parseMessageTemplate('See [deck](javascript:alert(1))');
  assert.equal(parsed.errors.some((error) => error.code === 'invalid_link'), true);
});

test('href sanitizer collapses doubled protocols, missing colons, and bare hosts', () => {
  assert.equal(
    sanitizeHref('https://https//calendly.com/lucas-heliosgroup/30min'),
    'https://calendly.com/lucas-heliosgroup/30min',
  );
  assert.equal(
    sanitizeHref('https://https://calendly.com/lucas-heliosgroup/30min'),
    'https://calendly.com/lucas-heliosgroup/30min',
  );
  assert.equal(
    sanitizeHref('https//calendly.com/lucas-heliosgroup/30min'),
    'https://calendly.com/lucas-heliosgroup/30min',
  );
  assert.equal(
    sanitizeHref('calendly.com/lucas-heliosgroup/30min'),
    'https://calendly.com/lucas-heliosgroup/30min',
  );
  assert.equal(sanitizeHref('http://example.com/path'), 'http://example.com/path');
  assert.equal(sanitizeHref('https://'), null);
  assert.equal(sanitizeHref('https://https'), null);
});

test('adaptHrefInput rewrites messy link-field entries as the user types', () => {
  assert.equal(
    adaptHrefInput('https://https//calendly.com/lucas-heliosgroup/30min'),
    'https://calendly.com/lucas-heliosgroup/30min',
  );
  assert.equal(
    adaptHrefInput('calendly.com/lucas-heliosgroup/30min'),
    'https://calendly.com/lucas-heliosgroup/30min',
  );
  assert.equal(adaptHrefInput('https://'), 'https://');
  assert.equal(adaptHrefInput('cal'), 'cal');
});

test('rewriteHrefsInMarkup repairs stored templates and draft bodies', () => {
  const template = parseMessageTemplate(
    'Talk <a href="https://https//calendly.com/lucas-heliosgroup/30min">here</a>',
  );
  assert.equal(template.errors.length, 0);
  assert.match(template.canonical, /href="https:\/\/calendly.com\/lucas-heliosgroup\/30min"/);

  const rewritten = rewriteHrefsInMarkup(
    'start the conversation here (https://https//calendly.com/lucas-heliosgroup/30min).',
  );
  assert.equal(
    rewritten,
    'start the conversation here (https://calendly.com/lucas-heliosgroup/30min).',
  );
});

test('fill blocks missing merge fields and succeeds when present', () => {
  const blocked = fillMessageTemplates({
    subjectTemplate: 'Hi {{firstName}}',
    bodyTemplate: 'Loved {{company}} in {{workLocation}}',
    fields: { ...SAMPLE_TEMPLATE_FIELDS, company: '', workLocation: '' },
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.deepEqual(blocked.missingTokens, ['company', 'workLocation']);
  }

  const filled = fillMessageTemplates({
    subjectTemplate: 'Hi {{firstName}}',
    bodyTemplate: 'Hi [First Name],\n\nLoved [Company Name].\nSee [deck](https://heliosgroup.ai).',
    fields: SAMPLE_TEMPLATE_FIELDS,
  });
  assert.equal(filled.ok, true);
  if (filled.ok) {
    assert.equal(filled.subject, 'Hi Jane');
    assert.match(filled.bodyText, /Loved Acme/);
    assert.match(filled.bodyHtml, /<a href="https:\/\/heliosgroup.ai\/"/);
    assert.match(filled.bodyHtml, /<br>/);
  }
});

test('composer round-trips chips, links, and line breaks', () => {
  const canonical = 'Hi {{firstName}},\n\nSee <a href="https://heliosgroup.ai/">deck</a>.';
  const html = templateToComposerHtml(canonical);
  assert.match(html, /data-token="firstName"/);
  assert.match(html, /<a href="https:\/\/heliosgroup.ai\/">deck<\/a>/);
  const back = composerHtmlToTemplate(html);
  assert.match(back, /\{\{firstName\}\}/);
  assert.match(back, /<a href="https:\/\/heliosgroup.ai\/">deck<\/a>/);
});

test('filled HTML preview preserves links when converted back', () => {
  const html = filledTemplateToHtml('See <a href="https://heliosgroup.ai/">deck</a>.');
  const composer = filledHtmlToComposerHtml(html);
  const canonical = composerHtmlToTemplate(composer);
  assert.match(canonical, /deck/);
  assert.equal(filledTemplateToPlainText(canonical).includes('https://heliosgroup.ai'), true);
});

test('chip text is what users type in the subject field', () => {
  assert.equal(templateToChipText('Hi {{firstName}} at {{company}}'), 'Hi [First Name] at [Company Name]');
});

test('create-time preview uses sample Jane / Acme values', () => {
  const preview = previewMessageTemplates({
    subjectTemplate: 'Hi [First Name]',
    bodyTemplate: 'Working with [Company Name]?',
  });
  assert.equal(preview.subject, 'Hi Jane');
  assert.match(preview.bodyText, /Acme/);
});

test('assertCustomMessageTemplates requires a non-empty subject and body', () => {
  assert.throws(() => assertCustomMessageTemplates({ subject: '', body: 'Hello' }));
  const ok = assertCustomMessageTemplates({
    subject: 'Hi [First Name]',
    body: 'Hello [Company Name]',
  });
  assert.equal(ok.subject, 'Hi {{firstName}}');
  assert.equal(ok.body.includes('{{company}}'), true);
});

test('refill states exclude approved, queued, and sent', () => {
  assert.equal(isTemplateRefillState('ready_for_review'), true);
  assert.equal(isTemplateRefillState('needs_lead_review'), true);
  assert.equal(isTemplateRefillState('failed_template_fill'), true);
  assert.equal(isTemplateRefillState('approved'), false);
  assert.equal(isTemplateRefillState('queued_rewrite'), false);
});

test('analytics content filter is campaign-level', () => {
  assert.equal(parseAnalyticsMessageMode(null), 'all');
  assert.equal(parseAnalyticsMessageMode('ai'), 'ai');
  assert.equal(parseAnalyticsMessageMode('custom'), 'custom');
  assert.equal(parseAnalyticsMessageMode('edited'), 'all');
});

test('template_fill jobs finish at $0 without Claude cost events', () => {
  const jobs = fs.readFileSync(path.join(process.cwd(), 'lib', 'drafting', 'jobs.ts'), 'utf8');
  assert.match(jobs, /template_fill: handleTemplateFill/);
  const handler = jobs.slice(jobs.indexOf('async function handleTemplateFill'));
  const body = handler.slice(0, handler.indexOf('\nconst HANDLERS'));
  assert.match(body, /actualCostUsd: '0\.0000'/);
  assert.doesNotMatch(body, /recordDraftingJobCostEvent/);
});

test('subject templates cannot contain line breaks', () => {
  const parsed = parseSubjectTemplate('Hello\nthere');
  assert.equal(parsed.errors.some((error) => /line break/i.test(error.message)), true);
});
