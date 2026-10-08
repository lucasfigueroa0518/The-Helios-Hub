/**
 * Is a SUBJECTS entry named in a piece of text? (photo spec §3 rule 3: the
 * Writer tags each slide with subject IDs; code checks the subject is named
 * on the slide. Captions are checked the same way.) Code, no AI.
 *
 * Naming rule (Tommy, 2026-10-07):
 *   person        the full name, or the last name; never the first name
 *   organization  the full name, or the first word when no other subject in
 *                 the story shares it (Google and Google DeepMind share
 *                 "Google": only the full names count)
 *   unknown type  the full name only (neither the identity check nor the
 *                 Reporter's mark says; older briefs)
 * The full name matches in any case; a single word matches as a whole word
 * with its capital. A name inside another subject's longer name doesn't
 * count ("Google" inside "Google DeepMind").
 */
import type { SubjectType } from './identity';

export type NamedSubject = { id: string; name: string; kind: SubjectType | null };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const whole = (form: string, flags: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(form)}(?=$|[^\\p{L}\\p{N}])`, `g${flags}`);
const wordsOf = (name: string) => name.trim().split(/\s+/).filter(Boolean);

/** The forms that count as naming this subject, given the story's other subjects. */
export function namedForms(s: NamedSubject, all: NamedSubject[]): Array<{ form: string; anyCase: boolean }> {
  const full = s.name.trim();
  const forms = [{ form: full, anyCase: true }];
  const words = wordsOf(full);
  if (words.length < 2) return forms;
  if (s.kind === 'person') forms.push({ form: words.at(-1)!, anyCase: false });
  if (s.kind === 'organization') {
    const first = words[0]!.toLowerCase();
    const shared = all.some((o) => o.id !== s.id && wordsOf(o.name)[0]?.toLowerCase() === first);
    if (!shared) forms.push({ form: words[0]!, anyCase: false });
  }
  return forms;
}

export function isNamedIn(s: NamedSubject, text: string, all: NamedSubject[] = [s]): boolean {
  if (!s.name.trim() || !text) return false;
  // Blank out other subjects' longer names that contain this one, so "Google" isn't found inside "Google DeepMind".
  let t = text;
  for (const o of all) {
    if (o.id === s.id || o.name.trim().length <= s.name.trim().length) continue;
    if (!whole(s.name.trim(), 'iu').test(o.name)) continue;
    t = t.replace(whole(o.name.trim(), 'iu'), (m, pre: string) => pre + ' '.repeat(m.length - pre.length));
  }
  return namedForms(s, all).some(({ form, anyCase }) => whole(form, anyCase ? 'iu' : 'u').test(t));
}

/** The IDs of the SUBJECTS entries named in the text, in SUBJECTS order. */
export function subjectIdsNamedIn(text: string, all: NamedSubject[]): string[] {
  return all.filter((s) => s.id && isNamedIn(s, text, all)).map((s) => s.id);
}

/**
 * SUBJECTS with their kinds: the identity check's type (by name) when it has
 * one, else the Reporter's mark (Tommy, 2026-10-07), else unknown.
 */
export function namedSubjects(subjects: Array<{ id: string; name: string; type?: SubjectType | null }>, kinds: Map<string, SubjectType | null> | null): NamedSubject[] {
  return subjects.filter((s) => s.id).map((s) => ({ id: s.id, name: s.name, kind: kinds?.get(s.name) ?? s.type ?? null }));
}
