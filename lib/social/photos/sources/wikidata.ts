/**
 * Verified sources (photo spec §2–§4): a person's Wikidata main photo and a
 * second photo of them; a company's CEO headshot and headquarters; its logo.
 * Every one comes from an identity-verified Wikidata entry, never from a name
 * match or an AI looking at a face, so the tag fit check never judges them.
 */
import { buildCredit } from '@/lib/social/editorial/v2/image-step/commons';
import type { VisualRequest } from '@/lib/social/writer/draft';

import type { Candidate, Source, SourceRun } from '../find';
import { orgPool, type OrgPool, type PoolPhoto } from '../org-pool';
import { identityOf, subjectP18 } from '../p18';

/** The identity check, logged once per request (the first subject checked). */
export async function verified(run: SourceRun, name: string) {
  const id = await identityOf(name, run.ctx.brief, run.deps, run.ctx.identities);
  run.identity ??= id.ok
    ? { subject: name, ok: true, detail: `${id.qid} "${id.label}" — ${id.description} (${id.type}, ${id.via})`, scores: id.scores }
    : { subject: name, ok: false, detail: id.reason, scores: id.scores };
  run.steps.push(id.ok ? `identity ok: ${id.qid} "${id.label}" (${id.type}, ${id.via})` : `identity failed for ${name}: ${id.reason}`);
  return id;
}

/** Face boxes for framing, when the detector is there. */
async function facesOf(run: SourceRun, url: string) {
  if (!run.deps.faces) return undefined;
  return (await run.deps.faces([url])).get(url) ?? undefined;
}

/** A person: their Wikidata main photo, then second photos (tagged as them by QID, name in the title, exactly one face). */
export const personSource: Source = async function personSource(request: VisualRequest, run: SourceRun) {
  const name = request.query;
  const id = await verified(run, name);
  if (!id.ok || id.type !== 'person') return [];
  const out: Candidate[] = [];
  const r = await subjectP18(name, run.ctx.brief, run.deps, run.ctx.identities);
  if (r.pick) {
    const faces = await facesOf(run, r.pick.url);
    out.push({ url: r.pick.url, credit: `${buildCredit(r.pick)} · Wikimedia Commons`, source: 'commons', width: r.pick.width, height: r.pick.height, qid: id.qid, subject: name, lane: 'headshot', date: r.pick.date ?? null, title: r.pick.file, verified: true, ...(faces ? { faces } : {}) });
    run.steps.push(`headshot (P18): ${r.pick.file}`);
  } else {
    run.steps.push(`headshot: ${r.why ?? 'no usable main photo'}`);
  }
  if (run.deps.secondPhotos && run.deps.faces) {
    const cands = await run.deps.secondPhotos(id.qid, name);
    const faces = cands.length ? await run.deps.faces(cands.map((c) => c.url)) : new Map();
    for (const c of cands) {
      const f = faces.get(c.url);
      if (!f || f.length !== 1) {
        run.steps.push(`second photo ${c.file}: ${f ? `${f.length} faces` : 'did not load'} → not used`);
        continue;
      }
      out.push({ url: c.url, credit: `${buildCredit(c)} · Wikimedia Commons`, source: 'second', width: c.width, height: c.height, qid: id.qid, subject: name, lane: 'second', date: c.date ?? null, title: c.file, verified: true, faces: f });
      run.steps.push(`second photo: ${c.file} (one face)`);
    }
  }
  return out;
};

/** The organization's pool (org-pool.ts), once per post per QID; null when the name isn't a verified organization. */
export async function poolOf(run: SourceRun, name: string): Promise<OrgPool | null> {
  const id = await verified(run, name);
  if (!id.ok || id.type !== 'organization') return null;
  let pending = run.ctx.orgPools.get(id.qid);
  if (!pending) {
    pending = orgPool({ qid: id.qid, label: id.label }, run.deps);
    run.ctx.orgPools.set(id.qid, pending);
    run.steps.push(...(await pending).notes.map((n) => `${id.label} ${n}`));
  }
  return pending;
}

const fromPool = (p: PoolPhoto, lane: Candidate['lane']): Candidate => ({ ...p, lane, date: p.date ?? null, title: p.subject ?? '', verified: true });

/** A company: its CEO's headshot (framed by faces) and its headquarters (org-pool.ts). */
export const companySource: Source = async function companySource(request: VisualRequest, run: SourceRun) {
  const pool = await poolOf(run, request.query);
  if (!pool) return [];
  const out: Candidate[] = [];
  if (pool.ceo) {
    const faces = await facesOf(run, pool.ceo.url);
    out.push({ ...fromPool(pool.ceo, 'ceo'), ...(faces ? { faces } : {}) });
  }
  if (pool.hq) out.push(fromPool(pool.hq, 'hq'));
  return out;
};

/** A company's logo card (logo.ts through the pool). */
export const logoSource: Source = async function logoSource(request: VisualRequest, run: SourceRun) {
  const pool = await poolOf(run, request.query);
  return pool?.logo ? [fromPool(pool.logo, 'logo')] : [];
};
