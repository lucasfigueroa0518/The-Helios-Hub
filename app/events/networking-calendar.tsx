'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import {
  Briefcase,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  List,
  MapPin,
  Plus,
  SlidersHorizontal,
  X,
} from 'lucide-react';

import { HubLoadingSpinner } from '@/app/hub/hub-loading';
import { requestJson } from '@/lib/client-request';
import { INDUSTRIES } from '@/lib/networking/taxonomy';
import type {
  AccessType,
  Bucket,
  IngestRunSummary,
  Metro,
  StoredNetworkingEvent,
} from '@/lib/networking/types';

type Counts = {
  total: number;
  boston: number;
  miami: number;
  tech: number;
  vertical: number;
  open: number;
  paid: number;
  inviteOnly: number;
};

type EventsResponse = {
  events: StoredNetworkingEvent[];
  counts: Counts;
  ingest: IngestRunSummary | null;
};

type MetroFilter = 'all' | Metro;
type WindowFilter = '30' | '90';
type ViewMode = 'calendar' | 'list';
type MenuSection = 'location' | 'duration' | 'rooms' | 'access' | 'industry' | 'view' | 'add';

const ACCESS_LABEL: Record<AccessType, string> = {
  open: 'Open',
  paid: 'Paid',
  invite_only: 'Invite-only',
};

const BUCKET_LABEL: Record<Bucket, string> = {
  tech: 'Tech',
  vertical: 'Vertical',
  both: 'Both',
};

const ACCESS_ACRONYMS = new Set(['rsvp', 'url', 'usd', 'ai', 'ml', 'llm']);
const CELL_PREVIEW = 3;
const PAGE_SIZE = 30;

function titleCaseAccess(value: string): string {
  return value
    .split(/([^\p{L}\p{N}]+)/u)
    .map((part) => {
      const lower = part.toLowerCase();
      if (ACCESS_ACRONYMS.has(lower)) return lower.toUpperCase();
      if (!/[\p{L}\p{N}]/u.test(part)) return part;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

function industryLabel(slug: string): string {
  return INDUSTRIES.find((item) => item.slug === slug)?.label || slug;
}

function eventDayKey(event: StoredNetworkingEvent): string {
  return format(new Date(event.startAt), 'yyyy-MM-dd');
}

function placeLines(event: StoredNetworkingEvent): { primary: string; secondary?: string } {
  const venue = event.venueName?.trim() || '';
  const city = event.city?.trim() || '';
  const address = event.address?.trim() || '';
  const primary = venue || city || (event.metro === 'boston' ? 'Boston' : 'Miami');
  const extras = [address, city].filter((part) => {
    if (!part) return false;
    return part.toLowerCase() !== primary.toLowerCase();
  });
  const unique = [...new Set(extras)];
  return unique.length ? { primary, secondary: unique.join(' · ') } : { primary };
}

function windowRange(days: WindowFilter): { from: string; to: string } {
  const from = new Date();
  const to = new Date(from.getTime() + Number(days) * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function cellPreview(events: StoredNetworkingEvent[]) {
  if (events.length <= CELL_PREVIEW) return { preview: events, overflow: 0 };
  return {
    preview: events.slice(0, CELL_PREVIEW - 1),
    overflow: events.length - (CELL_PREVIEW - 1),
  };
}

function metroLabel(metro: MetroFilter): string {
  if (metro === 'boston') return 'Boston';
  if (metro === 'miami') return 'Miami';
  return 'Both cities';
}

export function NetworkingCalendar() {
  const [metro, setMetro] = useState<MetroFilter>('all');
  const [bucket, setBucket] = useState<'' | Bucket>('');
  const [industry, setIndustry] = useState('');
  const [access, setAccess] = useState<'' | AccessType>('');
  const [windowDays, setWindowDays] = useState<WindowFilter>('90');
  const [view, setView] = useState<ViewMode>('calendar');
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [page, setPage] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openSection, setOpenSection] = useState<MenuSection | null>(null);
  const [data, setData] = useState<EventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<StoredNetworkingEvent | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [ingestBusy, setIngestBusy] = useState(false);
  const agendaRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) setView('list');
  }, []);

  async function load() {
    setError(null);
    const range = windowRange(windowDays);
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (metro !== 'all') params.set('metro', metro);
    if (bucket) params.set('bucket', bucket);
    if (industry) params.set('industry', industry);
    if (access) params.set('access', access);
    const payload = await requestJson<EventsResponse>(`/api/networking/events?${params}`);
    setData(payload);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load events');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metro, bucket, industry, access, windowDays]);

  useEffect(() => {
    setPage(1);
  }, [metro, bucket, industry, access, windowDays, view]);

  useEffect(() => {
    if (!selected && !menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (selected) setSelected(null);
      else setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [selected, menuOpen]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, StoredNetworkingEvent[]>();
    for (const event of data?.events ?? []) {
      const key = eventDayKey(event);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startAt.localeCompare(b.startAt));
    }
    return map;
  }, [data]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [month]);

  const listEvents = data?.events ?? [];
  const pageCount = Math.max(1, Math.ceil(listEvents.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageEvents = listEvents.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const selectedDayEvents = eventsByDay.get(format(selectedDay, 'yyyy-MM-dd')) ?? [];

  function showDay(day: Date) {
    setSelectedDay(day);
    if (!isSameMonth(day, month)) setMonth(startOfMonth(day));
    setView('calendar');
    setMenuOpen(false);
    requestAnimationFrame(() => {
      agendaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function toggleSection(section: MenuSection) {
    setOpenSection((current) => (current === section ? null : section));
  }

  async function onImport(event: FormEvent) {
    event.preventDefault();
    if (!importUrl.trim()) return;
    setImportBusy(true);
    setError(null);
    try {
      await requestJson('/api/networking/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl.trim(), force: true }),
      });
      setImportUrl('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportBusy(false);
    }
  }

  async function onRunIngest() {
    setIngestBusy(true);
    setError(null);
    try {
      await requestJson('/api/networking/ingest', { method: 'POST' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue ingest');
    } finally {
      setIngestBusy(false);
    }
  }

  if (loading && !data) return <HubLoadingSpinner label="Loading networking calendar" />;

  const counts = data?.counts;
  const industryValue = industry ? industryLabel(industry) : 'All industries';
  const accessValue = access ? ACCESS_LABEL[access] : 'All access';
  const roomsValue = bucket ? `${BUCKET_LABEL[bucket]} rooms` : 'All rooms';
  const viewValue = view === 'list' ? 'List' : 'Calendar';
  const mobileSummary = [metroLabel(metro), `${windowDays} days`, roomsValue, viewValue].join(' · ');

  const importForm = (
    <form className="networking-import" onSubmit={onImport}>
      <input
        type="url"
        value={importUrl}
        onChange={(e) => setImportUrl(e.target.value)}
        placeholder="Paste a Luma, Meetup, or Eventbrite URL"
        aria-label="Event URL"
      />
      <button className="btn btn--primary" type="submit" disabled={importBusy}>
        {importBusy ? 'Adding…' : 'Add event'}
      </button>
      <button className="btn" type="button" onClick={onRunIngest} disabled={ingestBusy}>
        {ingestBusy ? 'Queued…' : 'Run weekly ingest'}
      </button>
    </form>
  );

  return (
    <main className="app-shell networking-page">
      <section className="card">
        <div className="card__header">
          <div>
            <h1 className="card__title">Networking</h1>
            <p className="card__subtitle">
              In-person events in Boston and Miami metros, next {windowDays} days.
            </p>
          </div>
        </div>
        <div className="card__body networking-page__body">
          <div className="networking-desktop-controls">
            <div className="networking-stats">
              <button type="button" className={`stat-tile${metro === 'all' ? ' stat-tile--active' : ''}`} onClick={() => setMetro('all')}>
                <span className="stat-tile__label">Upcoming</span>
                <span className="stat-tile__value">{counts?.total ?? 0}</span>
              </button>
              <button type="button" className={`stat-tile${metro === 'boston' ? ' stat-tile--active' : ''}`} onClick={() => setMetro(metro === 'boston' ? 'all' : 'boston')}>
                <span className="stat-tile__label">Boston</span>
                <span className="stat-tile__value">{counts?.boston ?? 0}</span>
              </button>
              <button type="button" className={`stat-tile stat-tile--positive${metro === 'miami' ? ' stat-tile--active' : ''}`} onClick={() => setMetro(metro === 'miami' ? 'all' : 'miami')}>
                <span className="stat-tile__label">Miami</span>
                <span className="stat-tile__value">{counts?.miami ?? 0}</span>
              </button>
              <button type="button" className={`stat-tile networking-stat--tech${bucket === 'tech' ? ' stat-tile--active' : ''}`} onClick={() => setBucket(bucket === 'tech' ? '' : 'tech')}>
                <span className="stat-tile__label">Tech rooms</span>
                <span className="stat-tile__value">{counts?.tech ?? 0}</span>
              </button>
              <button type="button" className={`stat-tile networking-stat--vertical${bucket === 'vertical' ? ' stat-tile--active' : ''}`} onClick={() => setBucket(bucket === 'vertical' ? '' : 'vertical')}>
                <span className="stat-tile__label">Vertical rooms</span>
                <span className="stat-tile__value">{counts?.vertical ?? 0}</span>
              </button>
            </div>

            <div className="networking-toolbar">
              <div className="segmented" role="tablist" aria-label="Location">
                {(['all', 'boston', 'miami'] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`segmented__item${metro === id ? ' segmented__item--active' : ''}`}
                    onClick={() => setMetro(id)}
                  >
                    {id === 'all' ? 'Both' : id === 'boston' ? 'Boston' : 'Miami'}
                  </button>
                ))}
              </div>
              <div className="segmented" role="tablist" aria-label="Duration">
                {(['30', '90'] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`segmented__item${windowDays === id ? ' segmented__item--active' : ''}`}
                    onClick={() => setWindowDays(id)}
                  >
                    {id} days
                  </button>
                ))}
              </div>
              <div className="segmented" role="tablist" aria-label="View">
                <button type="button" className={`segmented__item${view === 'calendar' ? ' segmented__item--active' : ''}`} onClick={() => setView('calendar')}>
                  <CalendarDays size={14} /> Calendar
                </button>
                <button type="button" className={`segmented__item${view === 'list' ? ' segmented__item--active' : ''}`} onClick={() => setView('list')}>
                  <List size={14} /> List
                </button>
              </div>
              <label className="networking-select">
                <span>Access</span>
                <select value={access} onChange={(e) => setAccess(e.target.value as '' | AccessType)}>
                  <option value="">All</option>
                  <option value="open">Open</option>
                  <option value="paid">Paid</option>
                  <option value="invite_only">Invite-only</option>
                </select>
              </label>
              <label className="networking-select">
                <span>Industry</span>
                <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
                  <option value="">All</option>
                  {INDUSTRIES.map((item) => (
                    <option key={item.slug} value={item.slug}>{item.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {importForm}

            <p className="networking-health">
              {data?.ingest
                ? `Last ingest ${format(new Date(data.ingest.startedAt), 'MMM d, yyyy p')} · kept ${data.ingest.keptCount} · rejected ${data.ingest.rejectedCount}${data.ingest.status === 'running' ? ' · running' : ''}`
                : 'No ingest has run yet. Queue one to populate the calendar.'}
            </p>
          </div>

          <button type="button" className="networking-mobile-bar" onClick={() => setMenuOpen(true)}>
            <SlidersHorizontal size={18} aria-hidden="true" />
            <span className="networking-mobile-bar__copy">
              <strong>Filters & add</strong>
              <span>{mobileSummary}</span>
            </span>
            <ChevronDown size={18} aria-hidden="true" />
          </button>

          {error && <p className="networking-error">{error}</p>}

          {view === 'calendar' ? (
            <div className="networking-calendar">
              <div className="networking-calendar__nav">
                <button
                  type="button"
                  className="networking-calendar__nav-btn"
                  onClick={() => setMonth((current) => addMonths(current, -1))}
                  aria-label="Previous month"
                >
                  <ChevronLeft size={20} />
                </button>
                <h2>{format(month, 'MMMM yyyy')}</h2>
                <button
                  type="button"
                  className="networking-calendar__nav-btn"
                  onClick={() => setMonth((current) => addMonths(current, 1))}
                  aria-label="Next month"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
              <div className="networking-calendar__weekdays">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
                  <div key={label}>{label}</div>
                ))}
              </div>
              <div className="networking-calendar__grid">
                {days.map((day) => {
                  const key = format(day, 'yyyy-MM-dd');
                  const dayEvents = eventsByDay.get(key) ?? [];
                  const { preview, overflow } = cellPreview(dayEvents);
                  const isSelected = isSameDay(day, selectedDay);
                  return (
                    <div
                      key={key}
                      className={`networking-calendar__cell${isSameMonth(day, month) ? '' : ' is-muted'}${isSameDay(day, new Date()) ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}`}
                    >
                      <button
                        type="button"
                        className="networking-calendar__day-hit"
                        onClick={() => showDay(day)}
                        aria-pressed={isSelected}
                        aria-label={`${format(day, 'EEEE, MMMM d')}${dayEvents.length ? `, ${dayEvents.length} events` : ''}`}
                      >
                        <span className="networking-calendar__date">{format(day, 'd')}</span>
                        <span className="networking-calendar__dots" aria-hidden="true">
                          {dayEvents.slice(0, 3).map((item) => (
                            <span
                              key={item.id}
                              className={`networking-calendar__dot networking-calendar__dot--${item.bucket}`}
                            />
                          ))}
                          {dayEvents.length > 3 ? <span className="networking-calendar__dot-more" /> : null}
                        </span>
                      </button>
                      {preview.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`networking-calendar__event networking-event--${item.bucket}`}
                          onClick={() => setSelected(item)}
                        >
                          {item.title}
                        </button>
                      ))}
                      {overflow > 0 && (
                        <button
                          type="button"
                          className="networking-calendar__more"
                          onClick={() => showDay(day)}
                        >
                          +{overflow} more
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <section className="networking-agenda" ref={agendaRef} aria-live="polite">
                <div className="networking-agenda__header">
                  <h3>{format(selectedDay, 'EEEE, MMMM d')}</h3>
                  <span className="networking-agenda__count">
                    {selectedDayEvents.length === 1
                      ? '1 event'
                      : `${selectedDayEvents.length} events`}
                  </span>
                </div>
                <EventAgendaList events={selectedDayEvents} onOpen={setSelected} empty="No events this day." />
              </section>
            </div>
          ) : (
            <>
              <EventAgendaList
                events={pageEvents}
                onOpen={setSelected}
                empty="No events match these filters."
                showDate
              />
              <Pagination
                page={safePage}
                pageCount={pageCount}
                total={listEvents.length}
                onPage={setPage}
              />
            </>
          )}
        </div>
      </section>

      {menuOpen && (
        <div className="networking-menu" role="dialog" aria-modal="true" aria-labelledby="networking-menu-title">
          <div className="networking-menu__top">
            <div>
              <h2 id="networking-menu-title">Calendar controls</h2>
              <p>Location, duration, filters, view, and add event.</p>
            </div>
            <button type="button" className="drawer__close" onClick={() => setMenuOpen(false)} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="networking-menu__body">
            <FilterAccordion
              label="Location"
              value={metroLabel(metro)}
              open={openSection === 'location'}
              onToggle={() => toggleSection('location')}
            >
              <ChoiceList
                options={[
                  { id: 'all', label: 'Both cities' },
                  { id: 'boston', label: 'Boston' },
                  { id: 'miami', label: 'Miami' },
                ]}
                value={metro}
                onChange={(id) => setMetro(id as MetroFilter)}
              />
            </FilterAccordion>
            <FilterAccordion
              label="Duration"
              value={`${windowDays} days`}
              open={openSection === 'duration'}
              onToggle={() => toggleSection('duration')}
            >
              <ChoiceList
                options={[
                  { id: '30', label: 'Next 30 days' },
                  { id: '90', label: 'Next 90 days' },
                ]}
                value={windowDays}
                onChange={(id) => setWindowDays(id as WindowFilter)}
              />
            </FilterAccordion>
            <FilterAccordion
              label="Rooms"
              value={roomsValue}
              open={openSection === 'rooms'}
              onToggle={() => toggleSection('rooms')}
            >
              <ChoiceList
                options={[
                  { id: '', label: 'All rooms' },
                  { id: 'tech', label: 'Tech rooms' },
                  { id: 'vertical', label: 'Vertical rooms' },
                  { id: 'both', label: 'Both' },
                ]}
                value={bucket}
                onChange={(id) => setBucket(id as '' | Bucket)}
              />
            </FilterAccordion>
            <FilterAccordion
              label="Access"
              value={accessValue}
              open={openSection === 'access'}
              onToggle={() => toggleSection('access')}
            >
              <ChoiceList
                options={[
                  { id: '', label: 'All access' },
                  { id: 'open', label: 'Open' },
                  { id: 'paid', label: 'Paid' },
                  { id: 'invite_only', label: 'Invite-only' },
                ]}
                value={access}
                onChange={(id) => setAccess(id as '' | AccessType)}
              />
            </FilterAccordion>
            <FilterAccordion
              label="Industry"
              value={industryValue}
              open={openSection === 'industry'}
              onToggle={() => toggleSection('industry')}
            >
              <ChoiceList
                options={[
                  { id: '', label: 'All industries' },
                  ...INDUSTRIES.map((item) => ({ id: item.slug, label: item.label })),
                ]}
                value={industry}
                onChange={setIndustry}
              />
            </FilterAccordion>
            <FilterAccordion
              label="View"
              value={viewValue}
              open={openSection === 'view'}
              onToggle={() => toggleSection('view')}
            >
              <ChoiceList
                options={[
                  { id: 'list', label: 'List' },
                  { id: 'calendar', label: 'Calendar' },
                ]}
                value={view}
                onChange={(id) => setView(id as ViewMode)}
              />
            </FilterAccordion>
            <FilterAccordion
              label="Add event"
              value="Paste a URL"
              open={openSection === 'add'}
              onToggle={() => toggleSection('add')}
              icon={<Plus size={16} />}
            >
              {importForm}
              <p className="networking-health">
                {data?.ingest
                  ? `Last ingest ${format(new Date(data.ingest.startedAt), 'MMM d, yyyy p')} · kept ${data.ingest.keptCount} · rejected ${data.ingest.rejectedCount}`
                  : 'No ingest has run yet.'}
              </p>
            </FilterAccordion>
          </div>
          <div className="networking-menu__footer">
            <button type="button" className="btn btn--primary" onClick={() => setMenuOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}

      {selected && (
        <EventDetailDialog event={selected} onClose={() => setSelected(null)} />
      )}
    </main>
  );
}

function FilterAccordion({
  label,
  value,
  open,
  onToggle,
  children,
  icon,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className={`networking-acc${open ? ' is-open' : ''}`}>
      <button type="button" className="networking-acc__head" onClick={onToggle} aria-expanded={open}>
        <span className="networking-acc__copy">
          <span className="networking-acc__label">{icon}{label}</span>
          <span className="networking-acc__value">{value}</span>
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {open ? <div className="networking-acc__body">{children}</div> : null}
    </div>
  );
}

function ChoiceList({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="networking-choices" role="listbox">
      {options.map((option) => (
        <button
          key={option.id || 'all'}
          type="button"
          role="option"
          aria-selected={value === option.id}
          className={`networking-choice${value === option.id ? ' is-selected' : ''}`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total <= PAGE_SIZE) return null;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return (
    <div className="networking-pager">
      <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>{from}–{to} of {total}</span>
      <button type="button" className="btn" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}

function EventAgendaList({
  events,
  onOpen,
  empty,
  showDate = false,
}: {
  events: StoredNetworkingEvent[];
  onOpen: (event: StoredNetworkingEvent) => void;
  empty: string;
  showDate?: boolean;
}) {
  if (events.length === 0) {
    return <p className="networking-empty">{empty}</p>;
  }
  return (
    <ul className="networking-list">
      {events.map((item) => {
        const place = placeLines(item);
        const start = new Date(item.startAt);
        return (
          <li key={item.id}>
            <button
              type="button"
              className={`networking-agenda-row networking-event--${item.bucket}`}
              onClick={() => onOpen(item)}
            >
              <time className="networking-agenda-row__time" dateTime={item.startAt}>
                {showDate ? <span className="networking-agenda-row__day">{format(start, 'MMM d')}</span> : null}
                {format(start, 'p')}
              </time>
              <span className="networking-agenda-row__body">
                <span className="list-row__title">{item.title}</span>
                <span className="list-row__meta">
                  {place.primary}
                  {item.city && item.city !== place.primary ? ` · ${item.city}` : ''}
                </span>
              </span>
              <span className={`chip networking-detail__pill chip--${item.bucket}`}>
                {BUCKET_LABEL[item.bucket]}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function EventDetailDialog({
  event,
  onClose,
}: {
  event: StoredNetworkingEvent;
  onClose: () => void;
}) {
  const extraUrls = event.listingUrls.filter((url) => url !== event.canonicalUrl);
  const place = placeLines(event);
  const start = new Date(event.startAt);

  return (
    <div className="networking-dialog-overlay" role="presentation" onClick={onClose}>
      <div
        className="networking-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="networking-event-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer__header">
          <div>
            <h2 id="networking-event-title">{event.title}</h2>
          </div>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="drawer__body networking-detail">
          <a
            className="btn btn--primary networking-detail__cta"
            href={event.canonicalUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={16} aria-hidden="true" />
            Open event
          </a>
          {extraUrls.length > 0 && (
            <div className="networking-detail__more-links">
              {extraUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>
              ))}
            </div>
          )}

          <div className="networking-detail__pills">
            <span className={`chip networking-detail__pill networking-detail__pill--${event.access}`}>
              {ACCESS_LABEL[event.access]}
            </span>
            {event.accessEvidence && (
              <span className="chip networking-detail__pill">
                {titleCaseAccess(event.accessEvidence)}
              </span>
            )}
            <span className={`chip networking-detail__pill chip--${event.bucket}`}>
              {BUCKET_LABEL[event.bucket]}
            </span>
          </div>

          <dl className="networking-detail__facts">
            <div className="networking-detail__fact">
              <span className="networking-detail__fact-icon" aria-hidden="true"><Clock size={16} /></span>
              <div>
                <dt>When</dt>
                <dd>
                  {format(start, 'EEEE, MMM d, yyyy')}
                  <span className="networking-detail__fact-sub">{format(start, 'p')}</span>
                </dd>
              </div>
            </div>
            <div className="networking-detail__fact">
              <span className="networking-detail__fact-icon" aria-hidden="true"><MapPin size={16} /></span>
              <div>
                <dt>Where</dt>
                <dd>
                  {place.primary}
                  {place.secondary ? (
                    <span className="networking-detail__fact-sub">{place.secondary}</span>
                  ) : null}
                </dd>
              </div>
            </div>
            {event.industries.length > 0 && (
              <div className="networking-detail__fact">
                <span className="networking-detail__fact-icon" aria-hidden="true"><Briefcase size={16} /></span>
                <div>
                  <dt>Industry</dt>
                  <dd>{event.industries.map(industryLabel).join(', ')}</dd>
                </div>
              </div>
            )}
            {event.hostName && (
              <div className="networking-detail__fact">
                <span className="networking-detail__fact-icon" aria-hidden="true"><Building2 size={16} /></span>
                <div>
                  <dt>Host</dt>
                  <dd>{event.hostName}</dd>
                </div>
              </div>
            )}
          </dl>

          {event.description && (
            <div className="networking-detail__notes" tabIndex={0}>
              {event.description}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
