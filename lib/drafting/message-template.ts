/**
 * Custom-message campaign templates: closed-set merge fields, constrained
 * hyperlinks, and fill/sanitize helpers. No LLM. Pure functions only.
 */

import type { EffectiveLeadFields } from '@/lib/drafting/types';

export const MESSAGE_MODES = ['ai', 'custom'] as const;
export type MessageMode = (typeof MESSAGE_MODES)[number];

export const MISSING_TEMPLATE_FIELDS_ERROR = 'missing_template_fields';

export const MESSAGE_TEMPLATE_TOKENS = {
  firstName: {
    label: 'First Name',
    aliases: ['first name', 'firstname', 'first_name', 'first'],
  },
  fullName: {
    label: 'Full Name',
    aliases: ['full name', 'fullname', 'full_name', 'name'],
  },
  company: {
    label: 'Company Name',
    aliases: ['company name', 'company', 'company_name', 'firm', 'organization'],
  },
  title: {
    label: 'Position',
    aliases: ['position', 'title', 'job title', 'role'],
  },
  workLocation: {
    label: 'Location',
    aliases: ['location', 'work location', 'worklocation', 'work_location', 'city'],
  },
} as const;

export type MessageTemplateToken = keyof typeof MESSAGE_TEMPLATE_TOKENS;

export const MESSAGE_TEMPLATE_TOKEN_LIST = Object.keys(
  MESSAGE_TEMPLATE_TOKENS,
) as MessageTemplateToken[];

export const SAMPLE_TEMPLATE_FIELDS: EffectiveLeadFields = {
  email: 'jane@acme.com',
  fullName: 'Jane Doe',
  firstName: 'Jane',
  company: 'Acme',
  title: 'Partner',
  workLocation: 'New York',
};

export type TemplateParseError = {
  code: 'unknown_variable' | 'invalid_link' | 'empty';
  message: string;
  raw?: string;
};

export type ParsedTemplate = {
  canonical: string;
  tokens: MessageTemplateToken[];
  errors: TemplateParseError[];
};

const TOKEN_BY_ALIAS = (() => {
  const map = new Map<string, MessageTemplateToken>();
  for (const token of MESSAGE_TEMPLATE_TOKEN_LIST) {
    const spec = MESSAGE_TEMPLATE_TOKENS[token];
    map.set(normalizeAlias(spec.label), token);
    map.set(normalizeAlias(token), token);
    for (const alias of spec.aliases) {
      map.set(normalizeAlias(alias), token);
    }
  }
  return map;
})();

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

export function resolveTemplateToken(raw: string): MessageTemplateToken | null {
  const key = normalizeAlias(raw.replace(/^\{\{|\}\}$/g, '').replace(/^\[|\]$/g, ''));
  if (!key) return null;
  return TOKEN_BY_ALIAS.get(key) ?? null;
}

export function filterTemplateTokenSuggestions(query: string): MessageTemplateToken[] {
  const needle = normalizeAlias(query);
  if (!needle) return [...MESSAGE_TEMPLATE_TOKEN_LIST];
  return MESSAGE_TEMPLATE_TOKEN_LIST.filter((token) => {
    const spec = MESSAGE_TEMPLATE_TOKENS[token];
    if (normalizeAlias(spec.label).includes(needle)) return true;
    if (normalizeAlias(token).includes(needle)) return true;
    return spec.aliases.some((alias) => normalizeAlias(alias).includes(needle));
  });
}

/** Index of an unmatched `[` the user is typing, or -1. */
export function unmatchedOpenBracketIndex(textBeforeCursor: string): number {
  const open = textBeforeCursor.lastIndexOf('[');
  const close = textBeforeCursor.lastIndexOf(']');
  return open >= 0 && open > close ? open : -1;
}

export function canonicalTokenMarkup(token: MessageTemplateToken): string {
  return `{{${token}}}`;
}

export function isMessageMode(value: unknown): value is MessageMode {
  return value === 'ai' || value === 'custom';
}

export function parseMessageMode(value: unknown): MessageMode {
  return value === 'custom' ? 'custom' : 'ai';
}

/** Allow http(s) URLs only. Returns the normalized href or null. */
export function sanitizeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

const ANCHOR_RE = /<a\s+([^>]*?)>([\s\S]*?)<\/a>/gi;
const HREF_RE = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const MUSTACHE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
const BRACKET_RE = /\[([^\]]+)\](?!\()/g;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

function extractHref(attrs: string): string | null {
  const match = attrs.match(HREF_RE);
  if (!match) return null;
  return sanitizeHref(unescapeHtml(match[1] ?? match[2] ?? match[3] ?? ''));
}

function stripTagsKeepText(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

/**
 * Normalize a subject or body template into stored canonical form:
 * `{{token}}` merge fields, optional `<a href="https://...">label</a>`, newlines.
 */
export function parseMessageTemplate(input: string, options: { allowEmpty?: boolean } = {}): ParsedTemplate {
  const errors: TemplateParseError[] = [];
  const tokens = new Set<MessageTemplateToken>();
  const source = input.replace(/\r\n/g, '\n');

  const pieces: string[] = [];
  let cursor = 0;
  const combined = new RegExp(
    `${ANCHOR_RE.source}|${MARKDOWN_LINK_RE.source}|${MUSTACHE_RE.source}|${BRACKET_RE.source}`,
    'gi',
  );

  let match: RegExpExecArray | null;
  while ((match = combined.exec(source)) !== null) {
    if (match.index > cursor) {
      pieces.push(source.slice(cursor, match.index));
    }
    const raw = match[0];
    if (raw.toLowerCase().startsWith('<a')) {
      const href = extractHref(match[1] ?? '');
      const label = stripTagsKeepText(match[2] ?? '').trim() || href || '';
      if (!href) {
        errors.push({ code: 'invalid_link', message: 'Links must use http or https URLs', raw });
        pieces.push(label);
      } else {
        pieces.push(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
      }
    } else if (raw.startsWith('[') && raw.includes('](')) {
      const label = match[3] ?? '';
      const href = sanitizeHref(match[4] ?? '');
      if (!href) {
        errors.push({ code: 'invalid_link', message: 'Links must use http or https URLs', raw });
        pieces.push(label);
      } else {
        pieces.push(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
      }
    } else {
      const inner = (match[5] ?? match[6] ?? '').trim();
      const token = resolveTemplateToken(inner);
      if (!token) {
        errors.push({
          code: 'unknown_variable',
          message: `Unknown variable [${inner}]. Use First Name, Full Name, Company Name, Position, or Location.`,
          raw,
        });
        pieces.push(raw);
      } else {
        tokens.add(token);
        pieces.push(canonicalTokenMarkup(token));
      }
    }
    cursor = match.index + raw.length;
  }
  if (cursor < source.length) pieces.push(source.slice(cursor));

  const canonical = pieces.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  if (!options.allowEmpty && !canonical.replace(/<[^>]+>/g, '').trim()) {
    errors.push({ code: 'empty', message: 'Message cannot be empty' });
  }

  return {
    canonical,
    tokens: MESSAGE_TEMPLATE_TOKEN_LIST.filter((token) => tokens.has(token)),
    errors,
  };
}

export function parseSubjectTemplate(input: string): ParsedTemplate {
  const parsed = parseMessageTemplate(input);
  if (/\r|\n/.test(parsed.canonical)) {
    parsed.errors.push({
      code: 'unknown_variable',
      message: 'Subject cannot contain line breaks',
    });
  }
  return parsed;
}

export type TemplateFillSuccess = {
  ok: true;
  subject: string;
  bodyText: string;
  bodyHtml: string;
};

export type TemplateFillFailure = {
  ok: false;
  missingTokens: MessageTemplateToken[];
};

export type TemplateFillResult = TemplateFillSuccess | TemplateFillFailure;

function fieldValue(
  fields: EffectiveLeadFields,
  token: MessageTemplateToken,
): string {
  const value = fields[token];
  return typeof value === 'string' ? value.trim() : '';
}

export function missingTemplateTokens(
  tokens: readonly MessageTemplateToken[],
  fields: EffectiveLeadFields,
): MessageTemplateToken[] {
  return tokens.filter((token) => !fieldValue(fields, token));
}

function applyTokens(canonical: string, fields: EffectiveLeadFields): {
  filled: string;
  missing: MessageTemplateToken[];
} {
  const missing: MessageTemplateToken[] = [];
  const filled = canonical.replace(MUSTACHE_RE, (_, raw: string) => {
    const token = resolveTemplateToken(raw);
    if (!token) return '';
    const value = fieldValue(fields, token);
    if (!value) {
      if (!missing.includes(token)) missing.push(token);
      return '';
    }
    return value;
  });
  return { filled, missing };
}

/** Convert a filled canonical body (newlines + sanitized <a>) into send HTML. */
export function filledTemplateToHtml(filledCanonical: string): string {
  const normalized = filledCanonical.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => {
      const html = renderInline(paragraph).replace(/\n/g, '<br>\n');
      return `<p style="margin:0 0 1em 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111111;">${html}</p>`;
    })
    .join('\n');
}

function renderInline(paragraph: string): string {
  const parts: string[] = [];
  let cursor = 0;
  const re = /<a\s+([^>]*?)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(paragraph)) !== null) {
    if (match.index > cursor) {
      parts.push(escapeHtml(paragraph.slice(cursor, match.index)));
    }
    const href = extractHref(match[1] ?? '');
    const label = unescapeHtml(stripTagsKeepText(match[2] ?? ''));
    if (!href) {
      parts.push(escapeHtml(label));
    } else {
      parts.push(
        `<a href="${escapeHtml(href)}" style="color:#1155cc;text-decoration:underline;">${escapeHtml(label)}</a>`,
      );
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < paragraph.length) {
    parts.push(escapeHtml(paragraph.slice(cursor)));
  }
  return parts.join('');
}

export function filledTemplateToPlainText(filledCanonical: string): string {
  return filledCanonical
    .replace(/\r\n/g, '\n')
    .replace(/<a\s+[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_, href1, href2, label) => {
      const text = unescapeHtml(stripTagsKeepText(String(label))).trim();
      const href = href1 || href2 || '';
      return text && href ? `${text} (${href})` : text || href;
    })
    .replace(/<[^>]+>/g, '');
}

export function fillMessageTemplates(input: {
  subjectTemplate: string;
  bodyTemplate: string;
  fields: EffectiveLeadFields;
}): TemplateFillResult {
  const subjectParsed = parseSubjectTemplate(input.subjectTemplate);
  const bodyParsed = parseMessageTemplate(input.bodyTemplate);
  const tokens = [...new Set([...subjectParsed.tokens, ...bodyParsed.tokens])];
  const missing = missingTemplateTokens(tokens, input.fields);
  if (missing.length > 0) {
    return { ok: false, missingTokens: missing };
  }
  const subject = applyTokens(subjectParsed.canonical, input.fields).filled.replace(/\n/g, ' ').trim();
  const bodyFilled = applyTokens(bodyParsed.canonical, input.fields).filled;
  const bodyText = filledTemplateToPlainText(bodyFilled).trim();
  if (!subject || !bodyText) {
    return { ok: false, missingTokens: tokens.length ? tokens : ['firstName'] };
  }
  return {
    ok: true,
    subject,
    bodyText,
    bodyHtml: filledTemplateToHtml(bodyFilled),
  };
}

export function previewMessageTemplates(input: {
  subjectTemplate: string;
  bodyTemplate: string;
  fields?: EffectiveLeadFields;
}): { subject: string; bodyText: string; bodyHtml: string } {
  const result = fillMessageTemplates({
    subjectTemplate: input.subjectTemplate,
    bodyTemplate: input.bodyTemplate,
    fields: input.fields ?? SAMPLE_TEMPLATE_FIELDS,
  });
  if (!result.ok) {
    return {
      subject: input.subjectTemplate,
      bodyText: filledTemplateToPlainText(parseMessageTemplate(input.bodyTemplate, { allowEmpty: true }).canonical),
      bodyHtml: '',
    };
  }
  return { subject: result.subject, bodyText: result.bodyText, bodyHtml: result.bodyHtml };
}

export function assertCustomMessageTemplates(input: {
  subject?: string | null;
  body?: string | null;
}): { subject: string; body: string; tokens: MessageTemplateToken[] } {
  const subjectParsed = parseSubjectTemplate(input.subject ?? '');
  const bodyParsed = parseMessageTemplate(input.body ?? '');
  const errors = [...subjectParsed.errors, ...bodyParsed.errors];
  if (errors.length > 0) {
    throw new Error(errors[0]!.message);
  }
  if (!subjectParsed.canonical.trim()) {
    throw new Error('Subject is required');
  }
  return {
    subject: subjectParsed.canonical,
    body: bodyParsed.canonical,
    tokens: [...new Set([...subjectParsed.tokens, ...bodyParsed.tokens])],
  };
}

/** Composer display HTML: chips for tokens, real anchors, <br> for newlines. */
export function templateToComposerHtml(canonical: string): string {
  const parsed = parseMessageTemplate(canonical, { allowEmpty: true });
  const source = parsed.canonical || canonical.replace(/\r\n/g, '\n');
  const parts: string[] = [];
  let cursor = 0;
  const re = /<a\s+([^>]*?)>([\s\S]*?)<\/a>|\{\{\s*([^}]+?)\s*\}\}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    if (match.index > cursor) {
      parts.push(nlToBr(escapeHtml(source.slice(cursor, match.index))));
    }
    if (match[0].toLowerCase().startsWith('<a')) {
      const href = extractHref(match[1] ?? '');
      const label = unescapeHtml(stripTagsKeepText(match[2] ?? ''));
      if (href) {
        parts.push(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
      } else {
        parts.push(escapeHtml(label));
      }
    } else {
      const token = resolveTemplateToken(match[3] ?? '');
      if (token) {
        const label = MESSAGE_TEMPLATE_TOKENS[token].label;
        parts.push(
          `<span class="message-var" data-token="${token}" contenteditable="false">[${label}]</span>`,
        );
      } else {
        parts.push(escapeHtml(match[0]));
      }
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) {
    parts.push(nlToBr(escapeHtml(source.slice(cursor))));
  }
  return parts.join('') || '<br>';
}

function nlToBr(escaped: string): string {
  return escaped.replace(/\n/g, '<br>');
}

export function composerHtmlToTemplate(html: string): string {
  const withBreaks = html
    .replace(/<div><br\s*\/?><\/div>/gi, '\n')
    .replace(/<div>/gi, '\n')
    .replace(/<\/div>/gi, '')
    .replace(/<p>/gi, '')
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ');

  const pieces: string[] = [];
  let cursor = 0;
  const re = /<span[^>]*data-token="([^"]+)"[^>]*>[\s\S]*?<\/span>|<a\s+([^>]*?)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(withBreaks)) !== null) {
    if (match.index > cursor) {
      pieces.push(stripTagsKeepText(unescapeHtml(withBreaks.slice(cursor, match.index))));
    }
    if (match[1]) {
      const token = resolveTemplateToken(match[1]);
      pieces.push(token ? canonicalTokenMarkup(token) : '');
    } else {
      const href = extractHref(match[2] ?? '');
      const label = stripTagsKeepText(unescapeHtml(match[3] ?? '')).trim();
      if (href && label) {
        pieces.push(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
      } else {
        pieces.push(label);
      }
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < withBreaks.length) {
    pieces.push(stripTagsKeepText(unescapeHtml(withBreaks.slice(cursor))));
  }
  return pieces.join('').replace(/\n{3,}/g, '\n\n');
}

export function emptyLintResult(): { hard: []; warnings: [] } {
  return { hard: [], warnings: [] };
}

/** States that may be re-filled after a campaign template or lead-field edit. */
export const TEMPLATE_REFILL_STATES = [
  'ready_for_review',
  'needs_lead_review',
  'failed_template_fill',
] as const;

export function isTemplateRefillState(state: string): boolean {
  return (TEMPLATE_REFILL_STATES as readonly string[]).includes(state);
}

/** Render stored `{{token}}` markup as user-facing `[First Name]` chips. */
export function templateToChipText(canonical: string): string {
  return canonical.replace(MUSTACHE_RE, (_, raw: string) => {
    const token = resolveTemplateToken(raw);
    if (!token) return `[${raw}]`;
    return `[${MESSAGE_TEMPLATE_TOKENS[token].label}]`;
  });
}

/** Turn filled send HTML (paragraphs + anchors) back into composer HTML. */
export function filledHtmlToComposerHtml(html: string): string {
  const stripped = html
    .replace(/<!DOCTYPE[\s\S]*?<body[^>]*>/i, '')
    .replace(/<\/body>[\s\S]*$/i, '')
    .replace(/<\/?div[^>]*>/gi, '');
  const withBreaks = stripped
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/p>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return templateToComposerHtml(withBreaks || '');
}
