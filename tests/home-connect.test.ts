import assert from 'node:assert/strict';
import test from 'node:test';

import type { HomePayload } from '@/lib/home/loadHome';

function payload(unavailable?: HomePayload['unavailable']): HomePayload {
  return {
    displayName: 'Lucas',
    boards: [],
    projects: [],
    campaigns: [],
    outreachStats: {
      totalCampaigns: 0,
      liveCampaignsCount: 0,
      takingActionCampaignsCount: 0,
      activeCampaignNames: [],
      totalSent: 0,
      totalDelivered: 0,
      deliveryRate: null,
      totalInReviewOrDrafting: 0,
      emailsThisWeek: 0,
      sentThisWeek: 0,
      upcomingThisWeek: 0,
    },
    unavailable,
  };
}

async function renderHome(data: HomePayload): Promise<string> {
  const React = await import('react');
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { HubHome } = await import('@/components/hub-home/HubHome');
  return renderToStaticMarkup(React.createElement(HubHome, { data }));
}

test('a connection timeout does not look like an empty home', async () => {
  const html = await renderHome(payload({ boards: true, projects: true, campaigns: true }));
  assert.match(html, /Boards could not be loaded/);
  assert.match(html, /Dashboards could not be loaded/);
  assert.match(html, /Campaigns could not be loaded/);
  assert.doesNotMatch(html, /No boards yet/);
  assert.doesNotMatch(html, /No Active Dashboards/);
  assert.doesNotMatch(html, /No active campaigns/);
});

test('a real empty home still says nothing is there yet', async () => {
  const html = await renderHome(payload());
  assert.match(html, /No boards yet/);
  assert.match(html, /No Active Dashboards/);
  assert.match(html, /No active campaigns/);
  assert.doesNotMatch(html, /could not be loaded/);
});
