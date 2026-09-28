/**
 * Validate brief images before the Writer sees them:
 *   1. Link must return an image (HEAD content-type starts with "image/").
 *   2. Credit must look like a real name, not an instruction ("check the
 *      source", "TBD", "verify", "[…]" placeholders).
 *
 * Any image that fails either check gets dropped. If none pass, the brief's
 * IMAGES section becomes "None found" downstream so the Writer never
 * references a broken or fake image.
 *
 * The validation runs once per Reporter run, right before the Writer stage.
 * Numbering is preserved for the images that survive so "brief image N"
 * references in a re-run stay stable.
 */

import type { Brief, BriefImage } from './parse';

const HEAD_TIMEOUT_MS = 6_000;

export type ValidationResult = {
  valid: BriefImage[];
  dropped: DroppedImage[];
};

export type DroppedImage = {
  image: BriefImage;
  reason: string;
};

export async function validateBriefImages(brief: Brief): Promise<ValidationResult> {
  const valid: BriefImage[] = [];
  const dropped: DroppedImage[] = [];

  for (const img of brief.images) {
    const creditReason = looksLikeInstructionCredit(img.credit);
    if (creditReason) {
      dropped.push({ image: img, reason: creditReason });
      continue;
    }
    if (!img.link) {
      dropped.push({ image: img, reason: 'no Link URL' });
      continue;
    }
    const linkCheck = await headContentType(img.link);
    if (!linkCheck.ok) {
      dropped.push({ image: img, reason: linkCheck.reason });
      continue;
    }
    valid.push(img);
  }

  return { valid, dropped };
}

/**
 * Rewrite the SOURCES section of the raw brief text so only "substantive"
 * sources appear — the ones whose fetched text passed a minimum-length
 * threshold. Used by the Caption stage so the caption's "Source:" line
 * only lists outlets we actually read in full, not paywall previews.
 *
 * Order is preserved from the original SOURCES section.
 */
export function rewriteBriefSources(
  briefRaw: string,
  substantiveOutlets: Array<{ outlet: string; publishedAt: string; url: string }>,
): string {
  const rendered = substantiveOutlets.length === 0
    ? '(none — every source fetched was a preview under the threshold)'
    : substantiveOutlets
        .map((s, i) => {
          const outlet = s.outlet || '(unknown outlet)';
          const date = s.publishedAt ? `, ${s.publishedAt}` : '';
          const url = s.url ? `, ${s.url}` : '';
          return `${i + 1}. ${outlet}${date}${url}`;
        })
        .join('\n');
  // Replace everything from "SOURCES:" onward. SOURCES is the last
  // section of the brief, so no trailing label to preserve.
  return briefRaw.replace(
    /(^|\n)SOURCES:[\s\S]*$/,
    `$1SOURCES:\n${rendered}`,
  );
}

/**
 * Rewrite the brief.images list on the passed Brief and rebuild the
 * IMAGES section of the raw brief text so downstream stages see only
 * validated images (or "None found" when nothing survived).
 *
 * Numbering: the surviving images keep their original numbers so
 * "brief image 3" references stay consistent across runs. Dropped
 * numbers just don't appear in the section (a gap is fine).
 */
export function rewriteBriefWithValidatedImages(
  briefRaw: string,
  validImages: BriefImage[],
): string {
  const rendered = validImages.length === 0
    ? 'None found'
    : validImages
        .map((img) => {
          const line = `IMAGE ${img.number}: ${img.description}. Credit: ${img.credit}. Link: ${img.link}`;
          return line;
        })
        .join('\n');
  // Replace everything from "IMAGES:" up to (but not including) "SOURCES:"
  // with the validated block. The boundary is SOURCES: specifically —
  // matching any "[A-Z]…:" would stop on IMAGE 1: (which parses as a
  // label-shaped line), leaving the rest of the section untouched.
  return briefRaw.replace(
    /(^|\n)IMAGES:\s*[\s\S]*?(\nSOURCES:|$)/,
    `$1IMAGES:\n${rendered}\n$2`,
  );
}

/**
 * Fires a HEAD request. Falls back to GET (Range: bytes=0-0) if HEAD
 * returns 405 (some CDNs disallow HEAD). Success = 2xx with a
 * content-type that starts with "image/".
 */
async function headContentType(url: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { Range: 'bytes=0-0' },
        signal: controller.signal,
      });
    }
    if (!res.ok && res.status !== 206) {
      return { ok: false, reason: `HEAD returned HTTP ${res.status}` };
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!/^image\//i.test(contentType)) {
      return { ok: false, reason: `content-type is "${contentType || 'unknown'}", not image/*` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `fetch failed: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Return a reason string if the credit looks like a Reporter instruction
 * or placeholder (not a real attribution). Return null if the credit
 * looks legitimate.
 *
 * Heuristics (case-insensitive):
 *   - Empty or under 3 chars.
 *   - Starts with an instruction verb: "check", "verify", "see", "find",
 *     "confirm", "note", "example".
 *   - Bracketed placeholder: "[TBD]", "[…]", "[unknown]".
 *   - Contains "TBD", "unknown", "N/A", "???".
 *   - Ends with "…" or "..." (elided placeholder).
 */
function looksLikeInstructionCredit(credit: string): string | null {
  const trimmed = credit.trim();
  if (trimmed.length < 3) return `credit "${credit}" is empty or too short to be a real attribution`;
  const lower = trimmed.toLowerCase();
  if (/^(?:check|verify|see|find|confirm|note|example)\b/.test(lower)) {
    return `credit "${credit}" reads as an instruction to the writer, not an attribution`;
  }
  if (/^\[.*\]$/.test(trimmed)) {
    return `credit "${credit}" is a bracketed placeholder, not a real attribution`;
  }
  if (/\b(?:tbd|unknown|n\/a|placeholder)\b/i.test(trimmed) || /\?{2,}/.test(trimmed)) {
    return `credit "${credit}" contains a placeholder marker`;
  }
  if (/(?:…|\.{3})$/.test(trimmed)) {
    return `credit "${credit}" ends in an ellipsis, suggesting it was cut short`;
  }
  return null;
}
