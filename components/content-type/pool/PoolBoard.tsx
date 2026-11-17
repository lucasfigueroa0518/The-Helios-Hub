'use client';

import { ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';

import { Badge, flashClass, PostThumb } from '@/components/content-type/pool/bits';
import type { TypeCard } from '@/lib/content-type/model';
import type { BoardDay } from '@/lib/content-type/pool-view';
import { displayName } from '@/lib/social-hub/views/format';

/**
 * Next three days (pool UI contract §5): three day columns, ‹ › to step, today outlined in orange. A slot shows its
 * made post, else the idea queued to fill it (dashed, with when it gets made), else an open note. Days come from
 * poolBoard, the same fill as the list's Up next labels.
 */
export function PoolBoard({ days, canBack, canAhead, onBack, onAhead, cards, noun, wholeList, flashes, onOpenPost, onOpenIdea, loading = false }: {
  days: BoardDay[];
  canBack: boolean;
  canAhead: boolean;
  onBack: () => void;
  onAhead: () => void;
  cards: Record<string, TypeCard>;
  /** The item noun, singular ("topic"). */
  noun: string;
  /** Last Few Days and AI Events: a post is built from the whole list, so no one idea fills a slot. */
  wholeList: boolean;
  flashes: Record<string, number>;
  onOpenPost: (postId: string) => void;
  onOpenIdea: (ideaId: string) => void;
  loading?: boolean;
}) {
  const first = days[0];
  const last = days.at(-1);
  return (
    <section aria-label="Next three days">
      <div className="pl-days-head">
        <h2>Next three days</h2>
        {first && last ? <span className="pl-days-head__range">{first.weekday} {first.dayLabel} to {last.weekday} {last.dayLabel}</span> : null}
        <span className="pl-days-head__step">
          <button type="button" className="pl-icon-btn" onClick={onBack} disabled={!canBack} aria-label="Earlier days"><ChevronLeft className="pl-i" /></button>
          <button type="button" className="pl-icon-btn" onClick={onAhead} disabled={!canAhead} aria-label="Later days"><ChevronRight className="pl-i" /></button>
        </span>
      </div>
      <div className="pl-days">
        {loading
          ? [0, 1, 2].map((i) => (
            <div key={i} className="pl-daycol" aria-hidden="true">
              <span className="pl-sk-line" style={{ width: '40%' }} />
              <span className="pl-sk-line" />
              <span className="pl-sk-line" style={{ width: '70%' }} />
            </div>
          ))
          : days.map((day) => (
            <section key={day.date} className={`pl-daycol${day.isToday ? ' is-today' : ''}`} aria-label={`${day.weekday} ${day.dayLabel}`}>
              <header className="pl-daycol__head">
                <b>{day.weekday}</b><span>{day.dayLabel}</span>
                {day.isToday ? <span className="pl-today">Today</span> : null}
              </header>
              {day.slots.length === 0 ? <p className="pl-daycol__none">No slots this day.</p> : null}
              {day.slots.map((slot) => {
                if (slot.kind === 'post' && slot.post && slot.state) {
                  const card = cards[slot.post.id];
                  const post = slot.post;
                  return (
                    <button key={slot.id} type="button" className={`pl-slot${flashClass(flashes[post.id])}`} onClick={() => onOpenPost(post.id)}>
                      <PostThumb post={post} thumb={card?.thumb ?? null} remote={card?.remote} />
                      <span>
                        <span className="pl-slot__when">{slot.time}</span>
                        <span className="pl-slot__t">{displayName(post)}</span>
                        <Badge state={slot.state} />
                      </span>
                    </button>
                  );
                }
                if (slot.kind === 'idea' && slot.idea && slot.state) {
                  const idea = slot.idea;
                  return (
                    <button key={slot.id} type="button" className={`pl-slot pl-slot--idea${flashClass(flashes[idea.id])}`} onClick={() => onOpenIdea(idea.id)}>
                      <span className="pl-thumb" aria-hidden="true"><Lightbulb className="pl-i" /></span>
                      <span>
                        <span className="pl-slot__when">{slot.time} · {slot.makes}</span>
                        <span className="pl-slot__t">{idea.title}</span>
                        <Badge state={slot.state} />
                      </span>
                    </button>
                  );
                }
                return (
                  <div key={slot.id} className="pl-slot pl-slot--empty">
                    {slot.time}{slot.series ? ` · ${slot.series}` : ''} · {slot.past ? 'Nothing posted' : wholeList ? 'Open. The post is built from the top of the list.' : `Open. The pool has no ${noun} for it.`}
                  </div>
                );
              })}
            </section>
          ))}
      </div>
    </section>
  );
}
