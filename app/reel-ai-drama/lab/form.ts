/**
 * The lab's settings form, pure (tests/reel-ai-drama-lab-form.test.ts). Inputs hold text; a number
 * field that is empty or not a number is an error ("Enter a number") and is never sent as 0. A save is
 * one batch, `{ values }`, of only the editable keys that changed (HUB-WIRING-CONTRACT.md §2.2, §7.2).
 */

export const ENTER_A_NUMBER = 'Enter a number';

/** What the calibration run costs, said in one place (the button and the confirm). */
export const CALIBRATION_ESTIMATE = 'about $0.10–0.30';

export type FieldDraft = string | boolean;

export function parseNumberField(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const text = raw.trim();
  if (text === '') return { ok: false, error: ENTER_A_NUMBER };
  const value = Number(text);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, error: ENTER_A_NUMBER };
}

/** The text an input starts with for a stored value. */
export function draftOf(value: unknown): FieldDraft {
  return typeof value === 'boolean' ? value : value == null ? '' : String(value);
}

/**
 * The batch to POST: each editable key whose draft differs from the saved value, typed like the saved
 * value. Any bad number → `fields` (key → message) and nothing to send.
 */
export function settingsPayload(
  saved: Record<string, unknown>,
  drafts: Record<string, FieldDraft>,
  editable: readonly string[],
): { ok: true; values: Record<string, unknown> } | { ok: false; fields: Record<string, string> } {
  const values: Record<string, unknown> = {};
  const fields: Record<string, string> = {};
  for (const key of editable) {
    if (!(key in drafts)) continue;
    const draft = drafts[key];
    const current = saved[key];
    if (typeof current === 'boolean') {
      if (typeof draft === 'boolean' && draft !== current) values[key] = draft;
      continue;
    }
    const text = typeof draft === 'boolean' ? String(draft) : draft;
    if (typeof current === 'number') {
      const parsed = parseNumberField(text);
      if (!parsed.ok) fields[key] = parsed.error;
      else if (parsed.value !== current) values[key] = parsed.value;
      continue;
    }
    if (text !== draftOf(current)) values[key] = text;
  }
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, values };
}
