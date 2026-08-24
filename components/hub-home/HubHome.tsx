'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { format } from 'date-fns';

import { campaignHref } from '@/lib/home/campaignHref';
import type { HomePayload } from '@/lib/home/loadHome';

function tileArt(accent: string) {
  const stops = accent && accent.startsWith('#')
    ? `${accent}, #FF5E1A`
    : '#FFB347, #FF5E1A, #E03C1A';
  return `linear-gradient(135deg, ${stops})`;
}

export function formatWelcomeDateTime(date: Date): string {
  const dayOfWeek = format(date, 'EEEE');
  const monthDate = format(date, 'MMMM d');
  const timeAmPm = format(date, 'h:mm a');
  return `The day is ${dayOfWeek}, ${monthDate}. It is ${timeAmPm}`;
}

export function HubHome({ data }: { data: HomePayload }) {
  const [dateTimeText, setDateTimeText] = useState<string>('');
  const boardsEmpty = data.boards.length === 0;
  const dashboardsEmpty = data.projects.length === 0;
  const outreachEmpty = (data.outreachStats?.liveCampaignsCount ?? 0) === 0
    && (data.outreachStats?.totalSent ?? 0) === 0;

  useEffect(() => {
    setDateTimeText(formatWelcomeDateTime(new Date()));
    const timer = setInterval(() => {
      setDateTimeText(formatWelcomeDateTime(new Date()));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="hub-home">
      <div className="hub-home__glow hub-home__glow--green" aria-hidden="true" />
      <div className="hub-home__glow hub-home__glow--orange" aria-hidden="true" />
      <div className="hub-home__inner">
        <header className="hub-home__welcome">
          <p className="hub-home__welcome-kicker">Helios Hub</p>
          <h1 className="hub-home__welcome-title">Welcome, {data.displayName}</h1>
          {dateTimeText && (
            <p className="hub-home__welcome-subtitle">{dateTimeText}</p>
          )}
        </header>

        <section className={`hub-home__section${boardsEmpty ? ' hub-home__section--empty' : ''}`}>
          <div className="hub-home__section-head">
            <div className="hub-home__eyebrow">My Boards</div>
            <Link href="/trello" className="hub-home__action">Open Trello</Link>
          </div>
          {boardsEmpty ? (
            <p className="hub-home__empty">No boards yet</p>
          ) : (
            <div className="hub-home__carousel">
              {data.boards.map((board) => (
                <Link
                  key={board.id}
                  href={`/trello?board=${board.id}`}
                  className="hub-home-tile"
                  style={{ background: tileArt(board.accent) }}
                >
                  <span className="hub-home-tile__name">{board.name}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className={`hub-home__section${dashboardsEmpty ? ' hub-home__section--empty' : ''}`}>
          <div className="hub-home__section-head">
            <Link href="/dashboards" className="hub-home__eyebrow">My Client Dashboards</Link>
            <Link href="/dashboards" className="hub-home__action">Open dashboards</Link>
          </div>
          {dashboardsEmpty ? (
            <p className="hub-home__empty">No Active Dashboards</p>
          ) : (
            <div className="hub-home__carousel">
              {data.projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/dashboards/projects/${project.id}`}
                  className="hub-home-tile"
                  style={{ background: tileArt('#FF5E1A') }}
                >
                  <span className="hub-home-tile__name">{project.name}</span>
                </Link>
              ))}
              <Link href="/dashboards/projects/new" className="hub-home-tile hub-home-tile--new">
                <Plus size={16} />
                <span>New</span>
              </Link>
            </div>
          )}
        </section>

        <section className={`hub-home__section${outreachEmpty ? ' hub-home__section--empty' : ''}`}>
          <div className="hub-home__section-head">
            <Link href="/hub" className="hub-home__eyebrow">My Outreach</Link>
            <Link href="/hub" className="hub-home__action">Outreach Hub</Link>
          </div>
          {outreachEmpty ? (
            <p className="hub-home__empty">No active campaigns</p>
          ) : (
            <Link href="/hub" className="hub-home-outreach-bar">
              <div className="hub-home-outreach-bar__stats">
                <div className="hub-home-outreach-stat">
                  <span className="hub-home-outreach-stat__label">Live Campaigns</span>
                  <div className="hub-home-outreach-stat__val-group">
                    <span className="hub-home-outreach-stat__value">
                      {data.outreachStats?.liveCampaignsCount ?? 0}
                    </span>
                    {(data.outreachStats?.takingActionCampaignsCount ?? 0) > 0 && (
                      <span className="hub-home-outreach-stat__badge" title="Active campaigns taking action">
                        <span className="hub-home-outreach-stat__pulse-dot" />
                        {data.outreachStats.takingActionCampaignsCount} taking action
                      </span>
                    )}
                  </div>
                </div>

                <div className="hub-home-outreach-stat__divider" />

                <div className="hub-home-outreach-stat">
                  <span className="hub-home-outreach-stat__label">All-time emails sent</span>
                  <span className="hub-home-outreach-stat__value">
                    {(data.outreachStats?.totalSent ?? 0).toLocaleString()}
                  </span>
                </div>

                <div className="hub-home-outreach-stat__divider" />

                <div className="hub-home-outreach-stat">
                  <span className="hub-home-outreach-stat__label">All-time delivery rate</span>
                  <span className="hub-home-outreach-stat__value hub-home-outreach-stat__value--green">
                    {data.outreachStats?.deliveryRate != null
                      ? `${(data.outreachStats.deliveryRate * 100).toFixed(1)}%`
                      : '—'}
                  </span>
                </div>

                <div className="hub-home-outreach-stat__divider" />

                <div className="hub-home-outreach-stat">
                  <span className="hub-home-outreach-stat__label">Emails This Week</span>
                  <div className="hub-home-outreach-stat__val-group">
                    <span className="hub-home-outreach-stat__value">
                      {(data.outreachStats?.emailsThisWeek ?? 0).toLocaleString()}
                    </span>
                    <span className="hub-home-outreach-stat__subtext">Sent + queued + held</span>
                  </div>
                </div>
              </div>

              {(data.outreachStats?.activeCampaignNames ?? []).length > 0 && (
                <div className="hub-home-outreach-bar__action-strip">
                  <span className="hub-home-outreach-bar__action-label">Currently taking action:</span>
                  <div className="hub-home-outreach-bar__pills">
                    {data.outreachStats.activeCampaignNames.map((name) => (
                      <span key={name} className="hub-home-outreach-pill">
                        <span className="hub-home-outreach-pill__dot" />
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Link>
          )}
        </section>
      </div>
    </div>
  );
}
