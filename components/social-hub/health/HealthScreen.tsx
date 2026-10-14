import { NightRows } from '@/components/social-hub/health/NightRows';
import { ProblemsList } from '@/components/social-hub/health/ProblemsList';
import { ReadinessRings } from '@/components/social-hub/health/ReadinessRings';
import { HubLink } from '@/components/social-hub/nav/HubNav';
import { briefFor } from '@/lib/social-hub/health/brief';
import type { HealthModel } from '@/lib/social-hub/health/view';

/** Health (spec: social health and cost): last night's verdict, each type night by night, what keeps going wrong, what got fixed. */
export function HealthScreen({ model, base }: { model: HealthModel; base: string }) {
  const nights = model.rows[0]?.blocks.map((b) => b.night) ?? [];
  const briefs = Object.fromEntries([...model.problems, ...model.fixed].map((p) => [p.key, briefFor(p)]));
  return (
    <div className="sh-ops">
      <header className={`sh-ops-hero${model.clean ? ' is-clean' : ''}`}>
        {model.clean && <div className="sh-ops-burst" aria-hidden />}
        <p className="sh-ops-eyebrow">{model.eyebrow}</p>
        <h1 className="sh-ops-big">
          {model.clean ? <span className="sh-ops-good">{model.headline.lead}</span> : model.headline.lead}{' '}
          {model.headline.rest ?? (model.headline.emphasis && <em>{model.headline.emphasis}</em>)}
        </h1>
        {model.lede ? <p className="sh-ops-lede">{model.lede}</p> : null}
        {model.chips.length > 0 && (
          <ul className="sh-ops-chips">
            {model.chips.map((c, i) => <li key={c.id} className={c.best ? 'is-best' : undefined} style={{ animationDelay: `${120 * i}ms` }}>{c.text}</li>)}
          </ul>
        )}
      </header>

      <section aria-labelledby="h-nights">
        <div className="sh-ops-sechead">
          <h2 id="h-nights">Each type, night by night</h2>
          <nav className="sh-ops-seg" aria-label="Window">
            <HubLink href={`${base}/health`} history="replace" aria-current={model.windowNights === 14 ? 'page' : undefined}>14 nights</HubLink>
            <HubLink href={`${base}/health?nights=30`} history="replace" aria-current={model.windowNights === 30 ? 'page' : undefined}>30 nights</HubLink>
          </nav>
        </div>
        <p className="sh-ops-sub">One block per night, colored by its worst outcome. Hover a block to see what happened, or click to open that night.</p>
        <NightRows rows={model.rows} base={base} />
      </section>

      <ProblemsList problems={model.problems} fixed={model.fixed} briefs={briefs} base={base} clean={model.clean} nights={nights} />

      <ReadinessRings readiness={model.readiness} />
    </div>
  );
}
