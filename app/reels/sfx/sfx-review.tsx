'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { ReelVideo, Section } from '@/app/reels/ui';
import type { SfxFinalsReview, SfxReview, SfxReviewTiming } from '@/lib/reels/sfx/review';
import type { Hook, HookTiming } from '@/lib/reels/visual/hook';

const HOOK_LABEL: Record<Hook, string> = {
  glitch: 'Glitch',
  color_bars: 'Color bars',
  invert: 'Invert',
  vhs: 'VHS',
  thermal: 'Thermal',
  blue_screen: 'Blue screen',
};

const TIMING_LABEL: Record<HookTiming, string> = {
  double: 'Double',
  strobe: 'Strobe',
  tail: 'Tail',
};

const TIMINGS: HookTiming[] = ['double', 'strobe', 'tail'];

/** Digital silence is stored at -120 dBFS. */
const SILENT_DB = -120;

function sourceName(file: string): string {
  return file.replace(/\.wav$/i, '');
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}

function minus(value: number): string {
  return value < 0 ? `−${Math.abs(value)}` : String(value);
}

export function SfxReviewPage({
  review,
  finals,
  picks,
}: {
  review: SfxReview;
  finals: SfxFinalsReview;
  picks: Record<Hook, string>;
}) {
  const [target, setTarget] = useState(String(finals.fadeTarget));
  return (
    <div className="rh">
      <div className="rh__inner">
        <header className="rh__head">
          <div>
            <p className="rh__kicker">Trial Reels</p>
            <h1 className="rh__title">
              Hook sounds <span className="rh-beta">Review 2</span>
            </h1>
          </div>
          <div className="rh__head-actions">
            <Link href="/reels/audio" className="rh-btn">
              Audio
            </Link>
          </div>
        </header>

        <section className="rh-card rh-sfx__intro">
          <p className="rh-card__title">Pick the level and the gate-edge fade for the 18 finished sounds.</p>
          <p className="rh-muted">
            These are your six picks, each built for all three timings. Switch the level below and every player follows.
            A peak limiter holds every file at or under {minus(finals.settings.peakCeilingDb)} dBTP so all 18 can match
            (D-130). Listen for the cushion too: the last flicker rings for up to {finals.settings.cushionFrames} frames,
            then goes silent.
          </p>
          <p className="rh-muted">
            The limiter isn't equally light on every file. At −20 and quieter it takes off 5 dB at most. At −18,
            Whoosh, Pulse, and Crackle are pushed down up to 8 dB across most of their length. At −16 and −14 they get
            10–19 dB and still land short of the target. Each card shows its limiter load.
          </p>
          <p className="rh-muted">
            Under each player, the chart shows the sound level (dBFS, left) by frame (below). Shaded frames are where the
            hook is on, the hatched frames are the cushion, and the dashed line is where silence must start. Hover a frame
            for its level. This clip already had its text burned in, so the hook covers it here.
          </p>
        </section>

        <div className="rh-sfx__levels" role="radiogroup" aria-label="Level">
          <span className="rh-sfx__levels-label">Level (SFX-V2), dBFS RMS on the flickers</span>
          {finals.targets.map((value) => {
            const active = String(value) === target;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                className={`rh-pill rh-sfx__level${active ? ' rh-pill--selected' : ''}`}
                onClick={() => setTarget(String(value))}
              >
                {minus(value)}
              </button>
            );
          })}
        </div>

        <div className="rh-sfx__hooks">
          {finals.hooks.map((entry) => (
            <Section key={entry.hook} title={`${HOOK_LABEL[entry.hook]} · ${sourceName(entry.source)}`} open>
              <div className="rh-sfx__grid rh-sfx__grid--padded">
                {TIMINGS.map((timing) => (
                  <TimingCard
                    key={`${target}-${timing}`}
                    label={
                      <>
                        {TIMING_LABEL[timing]} <span>at {minus(Number(target))}</span>
                      </>
                    }
                    data={entry.byTarget[target][timing]}
                    fps={finals.fps}
                    chart={finals.chart}
                  />
                ))}
              </div>
            </Section>
          ))}

          <Section title={`Gate-edge fade (SFX-V3) · ${TIMING_LABEL[finals.fadeTiming]} at ${minus(finals.fadeTarget)}`} open>
            <p className="rh-sfx__reason">
              Each flicker fades in and out over this length, inside the flicker, so the off-frames stay silent. Strobe has
              the shortest flickers (2 frames, 83 ms), so it shows the trade-off best. “Edge vs sound” compares the
              brightness at each gate edge with the sound itself: above 0 dB is a click, and far below 0 means the attack
              has been softened.
            </p>
            {finals.hooks.map((entry) => (
              <article key={entry.hook} className="rh-sfx__candidate">
                <h3>
                  {HOOK_LABEL[entry.hook]} <span className="rh-sfx__source">{sourceName(entry.source)}</span>
                </h3>
                <div className="rh-sfx__grid">
                  {finals.fades.map((fade) => {
                    const data = entry.byFade[String(fade)];
                    return (
                      <TimingCard
                        key={fade}
                        label={
                          <>
                            {fade} ms fade <span>{TIMING_LABEL[finals.fadeTiming]}</span>
                          </>
                        }
                        data={data}
                        fps={finals.fps}
                        chart={finals.chart}
                        extra={[{ label: 'Edge vs sound', value: `${signed(data.edgeClickDb)} dB` }]}
                      />
                    );
                  })}
                </div>
              </article>
            ))}
          </Section>

          <Section title="Review 1 · candidates (picked 2026-09-27)">
            <p className="rh-sfx__reason">
              The two candidates per hook you picked from. These drafts used gain only, with the peak capped by sample
              peak, and no limiter.
            </p>
            {review.hooks.map(({ hook, candidates }) => (
              <article key={hook} className="rh-sfx__candidate">
                <h3>{HOOK_LABEL[hook]}</h3>
                {candidates.map((candidate, index) => {
                  const pickedFor = (Object.keys(picks) as Hook[]).filter((key) => picks[key] === candidate.source);
                  return (
                    <div key={candidate.slug} className="rh-sfx__candidate">
                      <h3>
                        <span className="rh-sfx__letter">{index === 0 ? 'A' : 'B'}</span> {sourceName(candidate.source)}
                        {pickedFor.map((key) => (
                          <span key={key} className="rh-pill rh-pill--selected">
                            Picked for {HOOK_LABEL[key].toLowerCase()}
                          </span>
                        ))}
                      </h3>
                      <p className="rh-sfx__reason">{candidate.reason}</p>
                      <div className="rh-sfx__grid">
                        {TIMINGS.map((timing) => (
                          <TimingCard
                            key={timing}
                            label={TIMING_LABEL[timing]}
                            data={candidate.timings[timing]}
                            fps={review.fps}
                            chart={review.chart}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </article>
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

function TimingCard({
  label,
  data,
  fps,
  chart,
  extra = [],
}: {
  label: ReactNode;
  data: SfxReviewTiming;
  fps: number;
  chart: SfxReview['chart'];
  extra?: Array<{ label: string; value: string }>;
}) {
  const m = data.metrics;
  const spread = Math.max(...m.spanRmsDb) - Math.min(...m.spanRmsDb);
  const offPeak = m.offPeakDb.length ? Math.max(...m.offPeakDb) : SILENT_DB;
  const facts: Array<{ label: string; value: string }> = [
    { label: 'Stretch', value: data.tempo === 1 ? 'None' : `${data.tempo.toFixed(2)}×` },
    { label: 'Starts at', value: `${Math.round(data.offsetMs)} ms` },
    { label: 'Gain', value: `${signed(m.gainDb)} dB${m.ceilingBound ? ' · peak-limited' : ''}` },
    { label: 'Flicker level', value: `${m.onRmsDb.toFixed(1)} dBFS` },
    { label: 'Flicker spread', value: `${spread.toFixed(1)} dB` },
    { label: 'Off-frames', value: offPeak <= SILENT_DB ? 'Silent' : `${offPeak.toFixed(1)} dBFS` },
    ...(m.limiter
      ? [
          {
            label: 'Limiter',
            value: m.limiter.maxReductionDb > 0 ? `−${m.limiter.maxReductionDb.toFixed(1)} dB max` : 'Idle',
          },
          { label: 'True peak', value: `${m.truePeakDb.toFixed(1)} dBTP` },
        ]
      : []),
    ...extra,
  ];
  return (
    <div className="rh-sfx__timing">
      <p className="rh-sfx__label">{label}</p>
      <div className="rh-reel__media rh-sfx__media">
        <ReelVideo src={`/api/reels/sfx/review?path=${encodeURIComponent(data.objectPath)}`} controls sound autoPlay={false} />
      </div>
      <SfxChart data={data} fps={fps} chart={chart} />
      <dl className="rh-facts rh-facts--three rh-sfx__facts">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ chart */

const W = 360;
const H = 132;
const PAD = { left: 30, right: 6, top: 8, bottom: 20 };
const FLOOR_DB = -60;

type FrameKind = 'on' | 'off' | 'cushion' | 'silent';

function frameKind(frame: number, map: SfxReviewTiming['map']): FrameKind {
  if (map.on.some(([a, b]) => frame >= a && frame <= b)) return 'on';
  if (frame <= map.lastOnFrame) return 'off';
  if (frame <= map.cushionEndFrame) return 'cushion';
  return 'silent';
}

const KIND_LABEL: Record<FrameKind, string> = {
  on: 'hook on, sound plays',
  off: 'hook off, must be silent',
  cushion: 'cushion, sound may ring out',
  silent: 'must be silent',
};

/**
 * Waveform over frames: the RMS envelope in eighth-frame windows, on a frame
 * grid with the on-frames shaded and the cushion hatched. One series, so the
 * title names it; the key explains the bands.
 */
export function SfxChart({ data, fps, chart }: { data: SfxReviewTiming; fps: number; chart: SfxReview['chart'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const frameW = plotW / chart.frames;
  const x = (frame: number) => PAD.left + frame * frameW;
  const y = (db: number) => PAD.top + ((0 - Math.max(FLOOR_DB, Math.min(0, db))) / -FLOOR_DB) * plotH;
  const base = PAD.top + plotH;
  const patternId = `rh-sfx-hatch-${data.objectPath.replace(/[^a-z0-9]/gi, '')}`;

  const windowW = frameW / chart.windowsPerFrame;
  let area = `M${PAD.left},${base}`;
  data.envelopeDb.forEach((db, index) => {
    const x0 = PAD.left + index * windowW;
    area += `L${x0.toFixed(2)},${y(db).toFixed(2)}L${(x0 + windowW).toFixed(2)},${y(db).toFixed(2)}`;
  });
  area += `L${PAD.left + data.envelopeDb.length * windowW},${base}Z`;

  const frames = Array.from({ length: chart.frames }, (_, frame) => frame);
  const hoverWindows =
    hover == null ? [] : data.envelopeDb.slice(hover * chart.windowsPerFrame, (hover + 1) * chart.windowsPerFrame);
  const hoverPeak = hoverWindows.length ? Math.max(...hoverWindows) : null;

  return (
    <figure className="rh-sfx__chart">
      <figcaption className="rh-sfx__key">
        <span>
          <i className="rh-sfx__swatch rh-sfx__swatch--on" /> Hook on
        </span>
        <span>
          <i className="rh-sfx__swatch rh-sfx__swatch--cushion" /> Cushion
        </span>
        <span>
          <i className="rh-sfx__swatch rh-sfx__swatch--level" /> Level
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Sound level by frame. Hook on at frames ${data.map.on.map(([a, b]) => `${a} to ${b}`).join(', ')}; cushion to frame ${data.map.cushionEndFrame}.`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <pattern id={patternId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--rh-line-strong)" strokeWidth="2" />
          </pattern>
        </defs>

        {frames.map((frame) => {
          const kind = frameKind(frame, data.map);
          if (kind === 'on') return <rect key={`b${frame}`} x={x(frame)} y={PAD.top} width={frameW} height={plotH} fill="var(--rh-accent-soft)" />;
          if (kind === 'cushion') return <rect key={`b${frame}`} x={x(frame)} y={PAD.top} width={frameW} height={plotH} fill={`url(#${patternId})`} />;
          return null;
        })}

        {[0, -20, -40, -60].map((db) => (
          <g key={db}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(db)} y2={y(db)} stroke="var(--rh-line)" strokeWidth="1" />
            <text x={PAD.left - 4} y={y(db) + 3} textAnchor="end" className="rh-sfx__tick">
              {db}
            </text>
          </g>
        ))}
        {frames.map((frame) => (
          <line key={`g${frame}`} x1={x(frame)} x2={x(frame)} y1={PAD.top} y2={base} stroke="var(--rh-line)" strokeWidth="0.5" />
        ))}

        <path d={area} fill="var(--rh-ink)" />

        <line
          x1={x(data.map.cushionEndFrame + 1)}
          x2={x(data.map.cushionEndFrame + 1)}
          y1={PAD.top}
          y2={base}
          stroke="var(--rh-muted)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />

        {frames
          .filter((frame) => frame % 2 === 0)
          .map((frame) => (
            <text key={`t${frame}`} x={x(frame) + frameW / 2} y={H - 6} textAnchor="middle" className="rh-sfx__tick">
              {frame}
            </text>
          ))}

        {hover != null && (
          <rect x={x(hover)} y={PAD.top} width={frameW} height={plotH} fill="none" stroke="var(--rh-ink)" strokeWidth="1.5" />
        )}
        {frames.map((frame) => (
          <rect
            key={`h${frame}`}
            x={x(frame)}
            y={0}
            width={frameW}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(frame)}
          />
        ))}
      </svg>
      <p className="rh-sfx__readout">
        {hover == null
          ? ''
          : `Frame ${hover} · ${(hover / fps).toFixed(3)}s · ${KIND_LABEL[frameKind(hover, data.map)]} · loudest ${
              hoverPeak == null || hoverPeak <= SILENT_DB ? 'silent' : `${hoverPeak.toFixed(1)} dBFS`
            }`}
      </p>
    </figure>
  );
}
