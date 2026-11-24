/**
 * The side-by-side review page (PHASE3-CONTRACT.md, Owner D): per post and frame, the shipped ("old") photo next to
 * the shared finder's ("new"), with the frame copy, the new trace and the post's cost. Self-contained: inline CSS,
 * no scripts, images hotlinked (http(s) only; anything else is shown as text).
 */
import type { CompareResults, FrameResult, PostResult } from './run';

/** Escapes text for HTML element content and quoted attributes. */
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]!);
}

/** A URL safe to hotlink: http(s) only, else null. */
export function webUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  try {
    const u = new URL(src);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function photoCell(title: string, p: { src: string; credit?: string | null; kind?: string | null; source?: string | null } | null, empty: string): string {
  if (!p) return `<div class="cell"><h4>${esc(title)}</h4><div class="none">${esc(empty)}</div></div>`;
  const url = webUrl(p.src);
  const meta = [p.kind, p.source, p.credit].filter(Boolean).map(esc).join(' · ');
  const img = url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" alt="${esc(title)}" loading="lazy" referrerpolicy="no-referrer"></a>`
    : `<div class="none">not a web URL: ${esc(p.src)}</div>`;
  return `<div class="cell"><h4>${esc(title)}</h4>${img}<div class="meta">${meta}</div></div>`;
}

function frameHtml(f: FrameResult, post: PostResult): string {
  const n = f.need;
  const subjects = n.subjects.map((s) => `${s.name} (${s.type})`).join(', ') || 'none';
  const newEmpty = post.outcome === 'ran' ? "nothing usable: today's finder would take this frame" : post.outcome === 'cap' ? 'not run (global cap)' : 'dry run';
  const trace = f.trace.length ? `<details><summary>trace (${f.trace.length})</summary><ol>${f.trace.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></details>` : '';
  return `<section class="frame">
<div class="fhead"><b>${esc(f.label)}</b> <span class="ask">${esc(n.kind)} “${esc(n.query)}” · ${esc(n.specificity)}${n.cover ? ' · cover' : ''} · subjects: ${esc(subjects)}</span></div>
${f.copy ? `<p class="copy">${esc(f.copy)}</p>` : ''}
<div class="pair">${photoCell('old (shipped)', f.old, 'no photo shipped')}${photoCell('new (shared finder)', f.new, newEmpty)}</div>
${trace}
</section>`;
}

function postHtml(p: PostResult): string {
  const notes = p.notes.length ? `<ul class="notes">${p.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  return `<article class="post">
<h2><span class="tag">${esc(p.type)}</span> ${esc(p.title)}</h2>
<div class="sub">${esc(p.date)} · ${esc(p.status)} · post ${esc(p.postId)} · exclude ${esc(p.excludeCount)} · cost $${esc(p.costUsd.toFixed(4))} · ${esc(p.outcome)}</div>
${notes}
${p.frames.map((f) => frameHtml(f, p)).join('\n')}
</article>`;
}

export function renderHtml(r: CompareResults): string {
  const skipped = r.skipped.length ? `<h2>Skipped</h2><ul class="notes">${r.skipped.map((s) => `<li>${esc(s.type)} ${esc(s.postId)}: ${esc(s.reason)}</li>`).join('')}</ul>` : '';
  const frames = r.posts.reduce((a, p) => a + p.frames.length, 0);
  const found = r.posts.reduce((a, p) => a + p.frames.filter((f) => f.new).length, 0);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Photo finder review</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--mut:#78716c;--line:#e7e5e4;--card:#fff;--acc:#ea580c}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#e7e5e4;--mut:#a8a29e;--line:#292524;--card:#1c1917;--acc:#fb923c}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1100px;margin:0 auto}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 4px}h4{margin:0 0 6px;font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
.sub,.meta,.ask{color:var(--mut);font-size:12px}.tag{background:var(--acc);color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;text-transform:uppercase}
.post{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:16px 0}
.frame{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}.copy{margin:6px 0}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media (max-width:640px){.pair{grid-template-columns:1fr}}
.cell img{width:100%;max-height:420px;object-fit:contain;background:var(--line);border-radius:6px}
.none{padding:30px 10px;text-align:center;color:var(--mut);border:1px dashed var(--line);border-radius:6px;word-break:break-all}
.notes{color:var(--mut);font-size:12px;margin:6px 0}details{font-size:12px;color:var(--mut);margin-top:6px}ol{padding-left:18px}li{word-break:break-word}
</style></head><body><main>
<h1>Shared photo finder: old vs new</h1>
<div class="sub">${esc(r.generatedAt)} · ${esc(r.mode)} · ${esc(r.posts.length)} post(s), ${esc(frames)} frame(s), ${esc(found)} new photo(s) · spent $${esc(r.spentUsd.toFixed(4))} of $${esc(r.capUsd.toFixed(2))}</div>
${r.posts.map(postHtml).join('\n')}
${skipped}
</main></body></html>
`;
}
