/**
 * Article photos and official images (photo spec §2–§3): the code-built list
 * from the pages the Reporter opened (article-list.ts). The caption and
 * credit rules are unchanged; what's new (sixth round) is that the search
 * tries them for every request whose kind they serve, instead of the Writer
 * asking for one by URL.
 *
 *   official  images from a SUBJECTS company's own page, for a company or
 *             product request. Text cards and banners are rejected by the
 *             vision call's "mostly text or banner" answer (spec §3 rule 4).
 *   named     body photos whose caption names the person or company asked
 *             for (event and product: one of the slide's tagged subjects).
 *
 * Date: the page's publish date. Size: the width the page states, when any.
 */
import type { VisualRequest } from '@/lib/social/writer/draft';

import { photoUrlKey, type ListedPhoto } from '../article-list';
import type { Candidate, Source, SourceRun } from '../find';

const day = (iso: string | null | undefined) => (iso ? /^\d{4}-\d{2}-\d{2}/.exec(iso)?.[0] ?? null : null);

/** The official-image text check: the vision call's "mostly text or banner" answer, once per URL per post. */
async function officialImageOk(run: SourceRun, p: ListedPhoto): Promise<boolean> {
  const cached = run.ctx.officialChecked.get(p.url);
  if (cached !== undefined) return cached;
  if (!run.deps.vision) {
    run.steps.push('official image: no vision check available → not used');
    run.ctx.officialChecked.set(p.url, false);
    return false;
  }
  const company = run.ctx.brief.subjects.find((s) => s.id === p.official_of)?.name ?? '';
  const v = await run.deps.vision({ url: p.url, scene: `an image from ${company}'s announcement`, subjects: run.ctx.brief.subjects.map((s) => s.name), title: p.caption ?? undefined });
  run.ctx.spend.visionUsd += v.costUsd;
  const ok = v.ok && !v.verdict.mostly_text_banner;
  run.steps.push(v.ok ? `official image text check: ${v.verdict.mostly_text_banner ? 'mostly text or a banner → rejected' : 'a picture → ok'} ($${v.costUsd.toFixed(4)})` : `official image text check error (${v.error}) → not used`);
  run.ctx.officialChecked.set(p.url, ok);
  return ok;
}

function toCandidate(run: SourceRun, p: ListedPhoto, lane: 'article' | 'official'): Candidate {
  const page = run.ctx.pages.find((x) => (x.resolvedUrl || x.url) === p.page);
  const company = run.ctx.brief.subjects.find((s) => s.id === p.official_of)?.name;
  return {
    url: p.url,
    credit: lane === 'official' ? `Image: ${company ?? 'the company'}` : (p.credit ?? p.caption ?? '').trim(),
    source: lane,
    width: p.width ?? null,
    height: null,
    qid: null,
    subject: null,
    lane,
    date: day(page?.publishedTime),
    title: (p.caption ?? '').trim(),
    // An article photo's caption names the subject (spec §3 rule 3); an official image comes from the company's own page.
    verified: true,
  };
}

/** The SUBJECTS IDs a request is about: its subject for person/company/logo, else the slide's tags. */
function idsFor(request: VisualRequest, run: SourceRun): string[] {
  const own = run.ctx.brief.subjects.find((s) => s.name === request.query)?.id;
  return own ? [own] : run.tags;
}

export function articleSource(mode: 'official' | 'named'): Source {
  const source: Source = async (request, run) => {
    const ids = idsFor(request, run);
    if (!ids.length) return [];
    const out: Candidate[] = [];
    for (const p of run.ctx.photos) {
      if (mode === 'official' ? !(p.official_of && ids.includes(p.official_of)) : p.official_of || !p.subject_ids.some((id) => ids.includes(id))) continue;
      // A person's photo only from a caption that names them (never an official image of their company).
      if (request.kind === 'person' && mode === 'official') continue;
      if (mode === 'official' && !(await officialImageOk(run, p))) continue;
      run.steps.push(`${mode === 'official' ? 'official image' : 'article photo'}: ${photoUrlKey(p.url).slice(-50)}${p.caption ? ` "${p.caption.slice(0, 60)}"` : ''}`);
      out.push(toCandidate(run, p, mode === 'official' ? 'official' : 'article'));
    }
    return out;
  };
  Object.defineProperty(source, 'name', { value: mode === 'official' ? 'officialImages' : 'articlePhotos' });
  return source;
}
