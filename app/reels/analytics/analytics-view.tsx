'use client';

import { useEffect, useState } from 'react';

import { Drawer } from '@/app/reels/ui';
import type { CostPage, DrillDetail, DrillLine } from '@/lib/reels/analytics/costs';
import type { CostPeriod, Ledger, StackSeries, Stat } from '@/lib/reels/analytics/rollups';

const PERIODS: Array<{ id: CostPeriod; label: string }> = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Custom' },
];

const LEDGERS: Array<{ id: Ledger; label: string }> = [
  { id: 'production', label: 'Production' },
  { id: 'development', label: 'Development' },
  { id: 'all', label: 'All' },
];

const VENDOR_COLOR: Record<string, string> = {
  anthropic: '#ff5e1a',
  openai: '#161616',
  jev: '#c27803',
  huggingface: '#138510',
  fal: '#3d5afe',
  other: '#a8a59d',
};

const ACTIVITY_COLOR: Record<string, string> = {
  ingest: '#ff5e1a',
  group: '#8d6e63',
  score: '#c27803',
  copy: '#3d5afe',
  image: '#138510',
  video: '#161616',
  song: '#7b1fa2',
  other: '#a8a59d',
};

function money(value: number | null, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  const places = digits === 2 && value !== 0 && Math.abs(value) < 0.005 ? 4 : digits;
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: places, minimumFractionDigits: places });
}

function shown(stat: Stat): string {
  if (stat.value == null) return '—';
  if (stat.kind === 'count') return stat.value.toLocaleString('en-US');
  if (stat.kind === 'ratio') return `${Math.round(stat.value * 100)}%`;
  return money(stat.value);
}

function side(value: number, kind: 'usd' | 'count'): string {
  return kind === 'usd' ? money(value) : value.toLocaleString('en-US');
}

function words(value: string): string {
  const known: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    jev: 'Jev',
    huggingface: 'Hugging Face',
    fal: 'Fal',
    ok: 'Finished',
    failed: 'Failed',
    copy: 'Copy',
    frame: 'Frame',
    video: 'Video',
  };
  return known[value] ?? value.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function href(period: CostPeriod, ledger: Ledger, from: string, to: string): string {
  const query = new URLSearchParams({ period, ledger });
  if (period === 'custom') {
    if (from) query.set('from', from);
    if (to) query.set('to', to);
  }
  return `/reels/analytics?${query.toString()}`;
}

export function AnalyticsView({ data }: { data: CostPage }) {
  const [open, setOpen] = useState<string | null>(null);
  const [stackBy, setStackBy] = useState<'vendor' | 'function'>('vendor');
  const report = data.report;
  const selected = [...report.headlines, ...report.stats, ...report.waste].find((stat) => stat.id === open) ?? null;

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <section className="rh-card rh-cap">
        <div>
          <p className="rh-cap__kicker">Production this month</p>
          <p className="rh-cap__total">
            {money(data.cap.spent)} <span>of {money(data.cap.watch, 0)}</span>
          </p>
          <p className="rh-muted">This watch counts production spend only. Spend before September 30 stays on the Development ledger.</p>
        </div>
        <dl className="rh-facts rh-facts--three">
          <div>
            <dt>Left</dt>
            <dd>{money(data.cap.left)}</dd>
          </div>
          <div>
            <dt>Pace</dt>
            <dd>{money(data.cap.perDay)} / day</dd>
          </div>
          <div>
            <dt>Days left</dt>
            <dd>{data.cap.daysLeft}</dd>
          </div>
        </dl>
      </section>

      <div className="rh-controls">
        <div className="segmented" role="tablist" aria-label="Period">
          {PERIODS.map((period) => (
            <a
              key={period.id}
              href={href(period.id, data.ledger, data.from, data.to)}
              role="tab"
              aria-selected={data.period === period.id}
              className={`segmented__item${data.period === period.id ? ' segmented__item--active' : ''}`}
            >
              {period.label}
            </a>
          ))}
        </div>
        <div className="segmented" role="tablist" aria-label="Ledger">
          {LEDGERS.map((ledger) => (
            <a
              key={ledger.id}
              href={href(data.period, ledger.id, data.from, data.to)}
              role="tab"
              aria-selected={data.ledger === ledger.id}
              className={`segmented__item${data.ledger === ledger.id ? ' segmented__item--active' : ''}`}
            >
              {ledger.label}
            </a>
          ))}
        </div>
        {data.period === 'custom' && (
          <form className="rh-range" action="/reels/analytics" method="get">
            <input type="hidden" name="period" value="custom" />
            <input type="hidden" name="ledger" value={data.ledger} />
            <input className="helios-field-input" name="from" defaultValue={data.from} placeholder="YYYY-MM-DD" aria-label="From" />
            <input className="helios-field-input" name="to" defaultValue={data.to} placeholder="YYYY-MM-DD" aria-label="To" />
            <button type="submit" className="rh-btn rh-btn--xs">Apply</button>
          </form>
        )}
      </div>

      <div className="rh-headlines">
        {report.headlines.map((stat) => (
          <StatButton key={stat.id} stat={stat} active={open === stat.id} onOpen={setOpen} />
        ))}
      </div>

      <ExpenseChart
        stackBy={stackBy}
        onStackBy={setStackBy}
        ledger={data.ledger}
        days={report.days}
        series={stackBy === 'vendor' ? report.vendors : report.activities}
        colors={stackBy === 'vendor' ? VENDOR_COLOR : ACTIVITY_COLOR}
      />

      <div className="rh-stat-grid">
        {report.stats.map((stat) => (
          <StatButton key={stat.id} stat={stat} active={open === stat.id} onOpen={setOpen} />
        ))}
      </div>

      <section className="rh-card">
        <h2 className="rh-card__title">Waste</h2>
        <div className="rh-stat-grid">
          {report.waste.map((stat) => (
            <StatButton key={stat.id} stat={stat} active={open === stat.id} onOpen={setOpen} />
          ))}
        </div>
      </section>

      {selected && (
        <Drawer label={selected.label} wide onClose={() => setOpen(null)}>
          <Drill stat={selected} detail={data.drills[selected.id]} />
        </Drawer>
      )}
    </>
  );
}

function StatButton({ stat, active, onOpen }: { stat: Stat; active: boolean; onOpen: (id: string) => void }) {
  return (
    <button type="button" className={`rh-stat${active ? ' is-active' : ''}`} onClick={() => onOpen(stat.id)}>
      <span className="rh-stat__label">{stat.label}</span>
      <span className="rh-stat__value">{shown(stat)}</span>
    </button>
  );
}

function Drill({ stat, detail }: { stat: Stat; detail?: DrillDetail }) {
  const lines: DrillLine[] = detail?.lines ?? [];
  const parts = detail?.factors ?? [];
  const formula = stat.denominator
    ? `${stat.numerator.label} ÷ ${stat.denominator.label}`
    : parts.length > 1
      ? 'The pieces below add up to this number.'
      : stat.numerator.label;
  return (
    <div className="rh-drill">
      <p className="rh-cap__kicker">How this number is built</p>
      <h2 className="rh-drill__title">{stat.label}</h2>
      <p className="rh-drill__result">{shown(stat)}</p>
      <p className="rh-muted">{formula}</p>
      <dl className="rh-facts">
        {stat.denominator ? (
          <>
            <div>
              <dt>{stat.numerator.label}</dt>
              <dd>{side(stat.numerator.value, stat.numerator.kind)}</dd>
            </div>
            <div>
              <dt>{stat.denominator.label}</dt>
              <dd>{side(stat.denominator.value, stat.denominator.kind)}</dd>
            </div>
          </>
        ) : (
          parts.map((part) => (
            <div key={part.label}>
              <dt>{words(part.label)}</dt>
              <dd>{side(part.value, part.kind)}</dd>
            </div>
          ))
        )}
        <div>
          <dt>Result</dt>
          <dd>{shown(stat)}</dd>
        </div>
      </dl>
      <h3 className="rh-card__sub">Recent runs</h3>
      {lines.length === 0 ? (
        <p className="rh-muted">No runs in this window for this stat.</p>
      ) : (
        <ul className="rh-drill__list">
          {lines.map((line, index) => (
            <li key={`${line.at}-${index}`}>
              <span className="rh-drill__when">{when(line.at)}</span>
              <span className="rh-drill__name">
                {words(line.title)}
                <span className="rh-muted">{words(line.detail)}</span>
              </span>
              <span className="rh-drill__usd">{line.usd == null ? '—' : money(line.usd)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExpenseChart({
  stackBy,
  onStackBy,
  ledger,
  days,
  series,
  colors,
}: {
  stackBy: 'vendor' | 'function';
  onStackBy: (next: 'vendor' | 'function') => void;
  ledger: Ledger;
  days: string[];
  series: StackSeries[];
  colors: Record<string, string>;
}) {
  const visible = series.filter((row) => row.values.some((value) => value > 0));
  const totals = days.map((_, index) => visible.reduce((sum, row) => sum + row.values[index], 0));
  const peak = Math.max(0.01, ...totals);
  const total = totals.reduce((sum, value) => sum + value, 0);
  const title = stackBy === 'vendor' ? 'Expenses by vendor' : 'Expenses by function';
  return (
    <section className="rh-card rh-chart">
      <div className="rh-chart__head">
        <div>
          <h2 className="rh-card__title">{title}</h2>
          <p className="rh-muted">{money(total)} in this window</p>
        </div>
        <div className="segmented" role="tablist" aria-label="Expense stack">
          <button
            type="button"
            role="tab"
            aria-selected={stackBy === 'vendor'}
            className={`segmented__item${stackBy === 'vendor' ? ' segmented__item--active' : ''}`}
            onClick={() => onStackBy('vendor')}
          >
            Vendor
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={stackBy === 'function'}
            className={`segmented__item${stackBy === 'function' ? ' segmented__item--active' : ''}`}
            onClick={() => onStackBy('function')}
          >
            Function
          </button>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="rh-muted">
          {ledger === 'production'
            ? 'No production spend in this window. Spend before September 30 is on the Development ledger.'
            : 'No spend in this window.'}
        </p>
      ) : (
        <>
          <div className="rh-stack" role="img" aria-label={title}>
            {days.map((day, index) => {
              const parts = visible
                .filter((row) => row.values[index] > 0)
                .map((row) => `${row.label} ${money(row.values[index])}`)
                .join(', ');
              return (
                <div key={day} className="rh-stack__col" title={parts ? `${day}: ${parts}` : day}>
                  <div className="rh-stack__bar" style={{ height: `${Math.max((totals[index] / peak) * 100, totals[index] > 0 ? 4 : 0)}%` }}>
                    {visible.map((row) =>
                      row.values[index] > 0 ? (
                        <span
                          key={row.key}
                          style={{
                            flexGrow: row.values[index],
                            background: colors[row.key] ?? '#a8a59d',
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                  <span className="rh-stack__label">{Number(day.slice(8))}</span>
                </div>
              );
            })}
          </div>
          <p className="rh-chart-legend">
            {visible.map((row) => (
              <span key={row.key}>
                <i style={{ background: colors[row.key] ?? '#a8a59d' }} />
                {row.label}
                <b>{money(row.values.reduce((sum, value) => sum + value, 0))}</b>
              </span>
            ))}
          </p>
        </>
      )}
    </section>
  );
}
