import { CostChart } from '@/components/social-hub/cost/CostChart';
import { CountUp } from '@/components/social-hub/cost/CountUp';
import { dollars, money, perUnit, shortDay } from '@/components/social-hub/cost/format';
import { InfoPop } from '@/components/social-hub/cost/InfoPop';
import { RangeControls } from '@/components/social-hub/cost/RangeControls';
import { WorthDrill, type WorthPost } from '@/components/social-hub/cost/WorthDrill';
import { HubLink } from '@/components/social-hub/nav/HubNav';
import { Thumb } from '@/components/social-hub/ui/Thumb';
import { CACHE_COVERED } from '@/lib/social-hub/cost-page/caching';
import type { CostModel } from '@/lib/social-hub/cost-page/model';
import type { CostParams } from '@/lib/social-hub/cost-page/params';
import type { HubPost, Vertical } from '@/lib/social-hub/types';
import { verticalInfo } from '@/lib/social-hub/verticals';

const WASTE_PARTS = [
  { key: 'rejected', label: 'Rejected or regenerated', short: 'Rejected', cls: 'is-rejected' },
  { key: 'failed', label: 'Failed mid-pipeline', short: 'Failed', cls: 'is-failed' },
  { key: 'expired', label: 'Expired unused', short: 'Expired', cls: 'is-expired' },
] as const;

/** The page's URL with one thing changed (the same keys parseCostParams reads). */
function costHref(base: string, p: CostParams, changes: { type?: Vertical | null }): string {
  const q = new URLSearchParams();
  if (p.range !== 'month') q.set('range', p.range);
  if (p.range === 'custom') { q.set('from', p.from); q.set('to', p.to); }
  const type = 'type' in changes ? changes.type : p.vertical;
  if (type) q.set('type', type);
  if (p.mode === 'development') q.set('mode', 'development');
  const s = q.toString();
  return `${base}/analytics/cost${s ? `?${s}` : ''}`;
}

function eyebrow(p: CostParams, monthClosed: boolean): string {
  const month = new Date(`${p.to.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const when = p.range === 'month' ? `${month}${monthClosed ? '' : ' so far'}` : `${shortDay(p.from)}–${shortDay(p.to)}`;
  return `${when} · ${p.mode} · usage only`;
}

/** Same wipe as Health's Fixed check: a mask scales in (transform only). */
function DrawnCheck({ id }: { id: string }) {
  return (
    <svg className="sh-ops-ck sh-cost-ok" viewBox="0 0 22 22" aria-hidden>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="22" height="22">
          <rect className="sh-ops-ck__wipe" x="0" y="0" width="22" height="22" fill="#fff" />
        </mask>
      </defs>
      <circle cx="11" cy="11" r="11" />
      <path d="M6.5 11.5l3 3 6-6.5" mask={`url(#${id})`} />
    </svg>
  );
}

const ratio = (a: number, b: number) => (b > 0 ? Math.min(1, Math.max(0, a / b)) : 0);

/** Cost (spec: social health and cost §6): what the machine spent, whether that's on pace, what it was worth, and what was wasted. */
export function CostScreen({ model, params, posts, base }: { model: CostModel; params: CostParams; posts: HubPost[]; base: string }) {
  const { pace } = model;
  const wasted = model.waste.rejected + model.waste.failed + model.waste.expired;
  const best = model.worth.best;
  const bestFollows = best?.post.metrics.follows ?? null;
  const worthPosts: WorthPost[] = posts
    .filter((p) => p.status === 'published' && p.postedAt && p.costMicros != null
      && p.postedAt.slice(0, 10) >= params.from && p.postedAt.slice(0, 10) <= params.to
      && (!params.vertical || p.vertical === params.vertical))
    .map((p) => ({ id: p.id, vertical: p.vertical, name: p.name, costMicros: p.costMicros!, metrics: p.metrics }));
  const wasteDelta = model.waste.prevPct === null ? null : model.waste.prevPct - model.waste.pct;
  // Same-route navigation keeps client state; a new filter key remounts the client parts so nothing points at a stale day or type.
  const viewKey = `${params.range}|${params.from}|${params.to}|${params.vertical ?? ''}|${params.mode}`;
  const rejection = [...model.rejection].sort((a, b) => (a.rate ?? Infinity) - (b.rate ?? Infinity));

  return (
    <div className="sh-ops sh-cost">
      <RangeControls key={`ctrls|${viewKey}`} params={params} />

      <header className="sh-ops-hero">
        <p className="sh-ops-eyebrow">{eyebrow(params, model.monthClosed)}</p>
        <p className="sh-cost-big">
          <span className="sh-ops-total" data-to={model.totalMicros}><CountUp micros={model.totalMicros} /></span>
          {model.unknownCalls > 0 && <span className="sh-cost-unknown">+ {model.unknownCalls} {model.unknownCalls === 1 ? 'call' : 'calls'} with unknown cost</span>}
        </p>
        <h1 className="sh-cost-lede">{model.headline}</h1>
        <div className="sh-cost-pace">
          <div className="sh-cost-pace__track">
            <i className={`sh-cost-pace__fill${pace.underWatch ? '' : ' is-over'}`} style={{ transform: `scaleX(${ratio(pace.spentMicros, pace.watchMicros)})` }} />
            <span className="sh-cost-pace__proj" style={{ left: `${ratio(pace.projectedMicros, pace.watchMicros) * 100}%` }} aria-hidden />
          </div>
          <div className="sh-cost-pace__labels">
            <span>{dollars(pace.spentMicros)} spent</span>
            <span>projected {dollars(pace.projectedMicros)}</span>
            <span>watch {dollars(pace.watchMicros)}</span>
          </div>
        </div>
        {model.chips.length > 0 && (
          <ul className="sh-ops-chips">
            {model.chips.map((c, i) => <li key={c.id} className={c.best ? 'is-best' : undefined} style={{ animationDelay: `${200 + 120 * i}ms` }}>{c.text}</li>)}
          </ul>
        )}
        {model.months.length > 0 && (
          <p className="sh-cost-months">
            Months closed under watch:
            {model.months.map((m) => (
              <span key={m.month} className={m.under === true ? 'is-under' : undefined}>
                {m.under === true ? `✓ ${m.label}` : m.under === false ? `${m.label} · over` : `${m.label} · ${pace.underWatch ? 'on track' : 'over pace'}`}
              </span>
            ))}
          </p>
        )}
      </header>

      <CostChart key={`chart|${viewKey}`} series={model.series} rows={model.historyRows} base={base} />

      <section aria-labelledby="h-budget">
        <div className="sh-ops-sechead is-start">
          <h2 id="h-budget">Budget</h2>
          <InfoPop title="Budget">Each type&apos;s spend this month against its monthly watch. Types with only a daily cap use the cap × days in the month.</InfoPop>
        </div>
        <p className="sh-ops-sub">Each type against its monthly watch. Click a card to filter the page to that type.</p>
        <div className="sh-cost-budget">
          {model.budget.map((b, i) => {
            const v = verticalInfo(b.vertical);
            const selected = params.vertical === b.vertical;
            return (
              <HubLink
                key={b.vertical}
                href={costHref(base, params, { type: selected ? null : b.vertical })}
                history="replace"
                className="sh-cost-card"
                aria-current={selected ? 'page' : undefined}
                aria-label={`${v.label}: ${dollars(b.spentMicros)} of ${dollars(b.watchMicros)}, on pace for ${dollars(b.projectedMicros)}${b.onPace ? '' : ', over watch'}. ${selected ? 'Show all types' : 'Filter to this type'}`}
              >
                {b.onPace && <DrawnCheck id={`sh-cost-ok-${b.vertical}`} />}
                <span className="sh-cost-card__nm"><i className="sh-ops-mark" style={{ background: `var(${v.colorVar})` }} aria-hidden />{v.label}</span>
                <span className="sh-cost-card__v">{dollars(b.spentMicros)} <small>of {dollars(b.watchMicros)}</small></span>
                <span className="sh-cost-card__d">on pace for {dollars(b.projectedMicros)}{b.onPace ? '' : ' · over watch'}</span>
                <span className="sh-cost-mini"><i className={b.onPace ? undefined : 'is-over'} style={{ transform: `scaleX(${ratio(b.spentMicros, b.watchMicros)})`, animationDelay: `${200 + i * 80}ms` }} /></span>
              </HubLink>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="h-worth">
        <div className="sh-ops-sechead is-start">
          <h2 id="h-worth">Worth</h2>
          <InfoPop title="Worth">What it cost to make the posts published in this range, divided by their interactions. Stories count replies, shares, follows and profile visits; the other types count total interactions.</InfoPop>
        </div>
        <p className="sh-ops-sub">What each interaction costs. Click a type for the breakdown by kind, then see its posts ranked by cost.</p>
        <WorthDrill key={`worth|${viewKey}`} byType={model.worth.byType} posts={worthPosts} base={base} />
        {best && (
          <div className="sh-cost-best">
            <Thumb post={best.post} size="lg" />
            <div className="sh-cost-best__text">
              <p className="sh-ops-eyebrow">Best value {params.range === 'month' ? 'this month' : 'in this range'}</p>
              <p className="sh-cost-best__name">{verticalInfo(best.post.vertical).short} · &ldquo;{best.post.name}&rdquo;</p>
              <p className="sh-ops-meta sh-ops-num">
                {best.interactions.toLocaleString('en-US')} interactions{bestFollows ? ` · ${bestFollows.toLocaleString('en-US')} follows` : ''} · cost {money(best.post.costMicros ?? 0, 1)}
              </p>
            </div>
            <div className="sh-cost-best__per">
              <b className="sh-ops-num">{perUnit(best.cpiMicros)}</b>
              <span className="sh-ops-eyebrow">per interaction</span>
            </div>
          </div>
        )}
        {model.caching.covered.length ? (
          <div className="sh-cost-save">
            <b className="sh-cost-save__n sh-ops-num"><CountUp micros={model.caching.savedMicros} ms={1300} /></b>
            <div>
              <b>saved by prompt caching {params.range === 'month' ? 'this month' : 'in this range'}</b>
              <p className="sh-ops-meta">
                {model.caching.covered.map((v) => verticalInfo(v).label).join(' and ')}, where cache use is recorded. Without caching, this range would have cost about {money(model.totalMicros + model.caching.savedMicros)}.
              </p>
            </div>
          </div>
        ) : (
          <div className="sh-cost-save">
            <div>
              <b>Prompt caching savings</b>
              <p className="sh-ops-meta">Not recorded for this type. Only {CACHE_COVERED.map((v) => verticalInfo(v).label).join(' and ')} record cache use.</p>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="h-waste">
        <div className="sh-ops-sechead is-start">
          <h2 id="h-waste">Waste</h2>
          <InfoPop title="Waste">Money spent on things that never posted. Rejected includes earlier attempts behind a regenerate. Filtered stories are the cost of choosing, shown separately and not counted as waste.</InfoPop>
        </div>
        <p className="sh-ops-sub">Money spent on things that never posted. Filtered stories are counted separately, as the cost of choosing.</p>
        <div className="sh-cost-waste">
          <div className="sh-cost-panel">
            <div className="sh-cost-waste__hd">
              <b className="sh-cost-waste__n sh-ops-num">{money(wasted, 1)} <span>wasted · {model.waste.pct}% of spend</span></b>
              {wasteDelta !== null && wasteDelta !== 0 && (
                <span className={`sh-cost-delta${wasteDelta > 0 ? ' is-down' : ''}`}>
                  {wasteDelta > 0 ? '↓' : '↑'} {Math.abs(wasteDelta)} pts vs last month
                </span>
              )}
            </div>
            {wasted > 0 && (
              <div className="sh-cost-wbar" role="img" aria-label={WASTE_PARTS.map((w) => `${w.short} ${money(model.waste[w.key], 1)}`).join(', ')}>
                {WASTE_PARTS.map((w) => {
                  const share = model.waste[w.key] / wasted;
                  return share > 0 ? <div key={w.key} className={w.cls} style={{ flexGrow: share }}>{share >= 0.3 ? `${w.short} ${money(model.waste[w.key], 1)}` : share >= 0.12 ? money(model.waste[w.key], 1) : ''}</div> : null;
                })}
              </div>
            )}
            {WASTE_PARTS.map((w) => (
              <div key={w.key} className="sh-cost-kv"><span><i className={`sh-cost-dot ${w.cls}`} aria-hidden />{w.label}</span><span className="sh-ops-num">{money(model.waste[w.key], 1)}</span></div>
            ))}
            <div className="sh-cost-kv is-muted"><span><i className="sh-cost-dot" aria-hidden />Selection cost (filtered, not waste)</span><span className="sh-ops-num">{money(model.waste.selection, 1)}</span></div>
          </div>
          <div className="sh-cost-panel">
            <p className="sh-ops-eyebrow">Rejection rate · 30 days</p>
            {rejection.map((r) => (
              <div key={r.vertical} className="sh-cost-rej">
                <span>{r.label}</span>
                <span className="sh-cost-rej__t"><i style={{ transform: `scaleX(${r.rate ?? 0})` }} /></span>
                <span className="sh-ops-num">{r.rate === null ? '—' : `${Math.round(r.rate * 100)}%`}</span>
              </div>
            ))}
            <p className="sh-ops-meta sh-cost-rej__note">Lower is closer to auto-publish. The same number feeds the readiness ring on Health.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
