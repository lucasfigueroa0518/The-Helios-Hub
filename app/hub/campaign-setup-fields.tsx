'use client';

import { shareOfCapacity } from '@/lib/inboxes/capacity';
import { formatNyDateLabel } from '@/lib/drafting/send-queue-schedule';

export function ChoiceCards<T extends string>({
  legend,
  value,
  onChange,
  options,
}: {
  legend: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ id: T; title: string; detail: string }>;
}) {
  return (
    <fieldset className="setup-choice">
      <legend className="setup-choice__legend">{legend}</legend>
      <div className="setup-choice__grid">
        {options.map((option) => {
          const on = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={`setup-choice__card${on ? ' is-on' : ''}`}
              aria-pressed={on}
              onClick={() => onChange(option.id)}
            >
              <strong>{option.title}</strong>
              <span>{option.detail}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const SHARE_PRESETS = [25, 50, 75, 100] as const;

export function CapacityShareField({
  pct,
  onChange,
  days,
}: {
  pct: number;
  onChange: (pct: number) => void;
  /** This sender's campaign caps, today first. */
  days?: Array<{ date: string; cap: number }>;
}) {
  const today = days?.[0];
  const todayCap = today?.cap ?? null;
  const todayShare = todayCap == null ? null : shareOfCapacity(todayCap, pct);
  const weekShare = days?.reduce((sum, day) => sum + shareOfCapacity(day.cap, pct), 0) ?? null;
  const next = days?.find((day) => day.cap > 0);

  let readout = 'Each day this campaign sends this share of the sender’s live inbox capacity. The number moves as mailboxes ramp.';
  if (todayCap != null && todayShare != null && weekShare != null) {
    readout = todayCap > 0
      ? `About ${todayShare} new ${todayShare === 1 ? 'email' : 'emails'} today, out of ${todayCap} this sender can send. ${weekShare} across the next 7 days.`
      : next
        ? `0 campaign emails today. On ${formatNyDateLabel(next.date)} this share is about ${shareOfCapacity(next.cap, pct)} of ${next.cap}. ${weekShare} across the next 7 days.`
        : 'This sender has no campaign capacity in the next 7 days. Warming mailboxes are not sending yet.';
  }

  return (
    <div className="capacity-share">
      <span className="setup-choice__legend">Daily volume</span>
      <div className="capacity-share__presets" role="group" aria-label="Share of inbox capacity">
        {SHARE_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`capacity-share__preset${pct === preset ? ' is-on' : ''}`}
            aria-pressed={pct === preset}
            onClick={() => onChange(preset)}
          >
            {preset}%
          </button>
        ))}
      </div>
      <label className="field capacity-share__custom">
        <span className="field__label">Percent of capacity</span>
        <input
          className="field__input"
          inputMode="numeric"
          value={String(pct)}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value.replace(/[^\d]/g, ''), 10);
            if (!Number.isFinite(next)) {
              onChange(1);
              return;
            }
            onChange(Math.max(1, Math.min(100, next)));
          }}
        />
      </label>
      <p className="capacity-share__readout">{readout}</p>
    </div>
  );
}
