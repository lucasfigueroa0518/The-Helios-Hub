/**
 * Article-photo credit check (spec §5.1; plan M5). Plain code, no AI.
 *
 * Reads caption + credit together as one text (Tommy, 2026-10-05), so a
 * credit filed in either field is caught.
 *
 *   rejected: wire/stock agencies, or the outlet's own staff
 *   allowed:  the company itself (a SUBJECTS organization), official
 *             government, Wikimedia Commons, open licences (CC0, CC BY,
 *             CC BY-SA, public domain)
 *   unknown:  anything else, including no credit → not used
 *
 * Rejection wins: "Courtesy of OpenAI / Getty Images" is rejected.
 * Rejections read all of caption + credit; an allowance needs credit
 * form (the credit field, or a labelled "Photo: / Courtesy of …" part of
 * the caption), so a caption that merely mentions OpenAI or NASA doesn't
 * clear a photo.
 */
import { outletKey, outletName } from '@/lib/social/ingest/select/outlets';

export type CreditVerdict = { verdict: 'allowed' | 'rejected' | 'unknown'; reason: string };

/** Wire and stock agencies, and outlets that sell their staff photos. Whole-word, case-insensitive. */
const AGENCIES = [
  'getty', 'gettyimages', 'afp', 'associated press', 'reuters', 'bloomberg', 'shutterstock', 'alamy',
  'epa', 'efe', 'sipa', 'zuma', 'anadolu', 'nurphoto', 'imagn', 'usa today', 'pool', 'xinhua', 'kyodo',
  'dpa', 'abaca', 'redux', 'polaris', 'stringer', 'staff',
];
/** "AP" only as its own word in credit form ("/AP", "AP Photo", "(AP)"). */
const AP = /(^|[\s/(|·,])AP($|[\s)/|·,.])|\bAP Photo\b/;

const OPEN_LICENCE = /\b(cc0|cc[\s-]?by(?:[\s-]?sa)?|creative commons|public domain|wikimedia commons|wikipedia)\b/i;
const GOVERNMENT = /\b(official white house photo|white house photo|u\.?s\.? (army|navy|air force|marine corps|coast guard|department of)|department of defense|dvids|nasa|library of congress|national archives|\.gov\b)/i;

/** "Photo: X", "Image by X", "Credit: X", "Courtesy of X": the label and everything after it. */
const LABELLED = /\b(?:(?:photo(?:graph)?|image|picture)s?(?:\s+credits?)?(?:\s+by\s+|\s*[:|]\s*)|credits?\s*[:|]\s*|courtesy(?:\s+of)?\s+|official white house photo)/i;

function creditForm(caption: string | null, credit: string | null): string {
  const m = caption ? LABELLED.exec(caption) : null;
  return [credit, m ? caption!.slice(m.index) : null].filter(Boolean).join(' · ');
}

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9.]+/g, ' ')} `;

export function classifyCredit(input: {
  caption: string | null;
  credit: string | null;
  /** URL of the article the photo appeared in (for the outlet's own-staff rule). */
  page: string | null;
  /** Organization names from the brief's SUBJECTS (a company crediting itself is allowed). */
  organizations: string[];
}): CreditVerdict {
  const text = [input.caption, input.credit].filter(Boolean).join(' · ').trim();
  if (!text) return { verdict: 'unknown', reason: 'no caption or credit' };
  const w = words(text);

  const agency = AGENCIES.find((a) => w.includes(` ${a} `));
  if (agency || AP.test(text)) return { verdict: 'rejected', reason: `agency credit (${agency ?? 'AP'})` };

  if (input.page) {
    const outlet = outletName({ feedKind: 'native', source: '', sourceUrl: input.page });
    // An outlet not in the name table comes back as its host ("cnbc.com"): match on "cnbc".
    const key = outletKey(/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(outlet) ? outlet.replace(/\.[a-z]{2,}$/i, '') : outlet);
    const flat = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key.length >= 3 && flat.includes(key)) return { verdict: 'rejected', reason: `outlet's own photo (${outlet})` };
  }

  const allowText = creditForm(input.caption, input.credit);
  if (!allowText) return { verdict: 'unknown', reason: 'no credit line' };
  if (GOVERNMENT.test(allowText)) return { verdict: 'allowed', reason: 'official government' };
  if (OPEN_LICENCE.test(allowText)) return { verdict: 'allowed', reason: 'open licence / Wikimedia Commons' };
  const aw = words(allowText);
  const org = input.organizations.find((o) => o.length >= 2 && aw.includes(` ${o.toLowerCase()} `));
  if (org) return { verdict: 'allowed', reason: `company's own photo (${org})` };

  return { verdict: 'unknown', reason: 'credit not recognised' };
}
