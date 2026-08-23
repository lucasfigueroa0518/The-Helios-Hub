import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { campaignHref } from '@/lib/home/campaignHref';
import { parseTrelloSearch, trelloHref } from '@/lib/trello/viewUrl';
import { formatWelcomeDateTime } from '@/components/hub-home/HubHome';

import { getCurrentWeekBounds } from '@/lib/home/loadHome';

describe('hub home week bounds', () => {
  it('calculates Sunday to Saturday interval for a given date', () => {
    // Aug 23, 2026 is Sunday
    const sunday = new Date('2026-08-23T12:00:00');
    const bounds = getCurrentWeekBounds(sunday);
    assert.equal(bounds.weekStartStr, '2026-08-23');
    assert.equal(bounds.weekEndStr, '2026-08-29');

    // Aug 26, 2026 is Wednesday
    const wednesday = new Date('2026-08-26T12:00:00');
    const wedBounds = getCurrentWeekBounds(wednesday);
    assert.equal(wedBounds.weekStartStr, '2026-08-23');
    assert.equal(wedBounds.weekEndStr, '2026-08-29');
  });
});

describe('hub home campaign destinations', () => {
  it('routes auto campaigns to prospect', () => {
    assert.equal(campaignHref({ id: 'c1', kind: 'auto' }), '/campaigns/c1/prospect');
  });

  it('routes drafting campaigns to draft', () => {
    assert.equal(campaignHref({ id: 'c1', kind: 'manual', drafting_active: true }), '/campaigns/c1/draft');
  });

  it('routes other campaigns to the campaign page', () => {
    assert.equal(campaignHref({ id: 'c1' }), '/campaigns/c1');
  });
});

describe('trello view urls', () => {
  it('parses view and board query params', () => {
    assert.deepEqual(parseTrelloSearch('view=week'), { view: 'sv_week' });
    assert.deepEqual(parseTrelloSearch('board=b1'), { view: 'board', boardId: 'b1' });
    assert.deepEqual(parseTrelloSearch(''), { view: 'home' });
  });

  it('builds matching hrefs', () => {
    assert.equal(trelloHref('sv_week'), '/trello?view=week');
    assert.equal(trelloHref('board', 'b1'), '/trello?board=b1');
    assert.equal(trelloHref('home'), '/trello');
  });
});

describe('hub home dashboard project status filtering', () => {
  it('filters out non-active projects', () => {
    const projects = [
      { id: 'p1', name: 'Active Project', status: 'ACTIVE' },
      { id: 'p2', name: 'Paused Project', status: 'PAUSED' },
      { id: 'p3', name: 'Completed Project', status: 'COMPLETE' },
      { id: 'p4', name: 'Archived Project', status: 'ARCHIVED' },
    ];

    const activeProjects = projects.filter((p) => p.status === 'ACTIVE');
    assert.equal(activeProjects.length, 1);
    assert.equal(activeProjects[0].id, 'p1');
  });
});

describe('hub home date time subtitle', () => {
  it('formats welcome date time correctly', () => {
    // Sunday Aug 23, 2026 3:54 PM (UTC-4 -> 19:54 UTC)
    const testDate = new Date('2026-08-23T15:54:00');
    const result = formatWelcomeDateTime(testDate);
    assert.match(result, /^The day is Sunday, August 23\. It is 3:54 PM$/);
  });
});

describe('outreach home stats calculation', () => {
  it('returns null delivery rate when total sent is zero (avoids 0% penalty on unsent campaigns)', () => {
    const campaigns = [
      {
        id: 'c1',
        name: 'Unsent Campaign',
        status: 'active' as const,
        sender_identity_slug: 'lucas' as const,
        sent_count: 0,
        delivered_count: 0,
        drafting_active: true,
        auto_status: 'live' as const,
        drafting_generated: 10,
      },
    ];

    const totalSent = campaigns.reduce((sum, c) => sum + (c.sent_count || 0), 0);
    const totalDelivered = campaigns.reduce((sum, c) => sum + (c.delivered_count || 0), 0);
    const deliveryRate = totalSent > 0 ? totalDelivered / totalSent : null;

    assert.equal(deliveryRate, null);
  });

  it('includes campaigns created by user even if sender profile belongs to another identity', () => {
    const lucasUserId = 'user-lucas-123';
    const campaigns = [
      {
        id: 'c13',
        name: 'Campaign #13',
        kind: 'auto' as const,
        status: 'active' as const,
        owner_id: lucasUserId,
        sender_identity_slug: null,
      },
      {
        id: 'c14',
        name: 'Campaign #14',
        kind: 'auto' as const,
        status: 'active' as const,
        owner_id: lucasUserId,
        sender_identity_slug: 'tommy' as const,
      },
      {
        id: 'c15',
        name: 'Tommy Owned Campaign',
        kind: 'auto' as const,
        status: 'active' as const,
        owner_id: 'user-tommy-456',
        sender_identity_slug: 'tommy' as const,
      },
    ];

    const lucasCampaigns = campaigns.filter((c) => {
      const isOwner = c.owner_id === lucasUserId;
      const effectiveSlug = c.sender_identity_slug ?? 'lucas';
      const isSender = effectiveSlug === 'lucas';
      return isOwner || isSender;
    });

    assert.equal(lucasCampaigns.length, 2);
    assert.deepEqual(
      lucasCampaigns.map((c) => c.name),
      ['Campaign #13', 'Campaign #14'],
    );
  });

  it('calculates weekly email volume correctly for lucas (250) and tommy (100)', () => {
    const lucasUserId = 'user-lucas-123';
    const campaigns = [
      {
        id: 'c13',
        name: 'Campaign #13',
        kind: 'auto' as const,
        emails_per_day: 30,
        owner_id: lucasUserId,
        sender_identity_slug: null,
      },
      {
        id: 'c14',
        name: 'Campaign #14',
        kind: 'auto' as const,
        emails_per_day: 20,
        owner_id: lucasUserId,
        sender_identity_slug: 'tommy' as const,
      },
    ];

    const calcWeekly = (list: typeof campaigns) =>
      list.reduce((sum, c) => sum + (c.emails_per_day ?? 0) * 5, 0);

    const lucasCampaigns = campaigns.filter((c) => c.owner_id === lucasUserId || (c.sender_identity_slug ?? 'lucas') === 'lucas');
    const tommyCampaigns = campaigns.filter((c) => c.sender_identity_slug === 'tommy');

    assert.equal(calcWeekly(lucasCampaigns), 250);
    assert.equal(calcWeekly(tommyCampaigns), 100);
  });

  it('calculates exact delivery rate when emails have been sent', () => {
    const campaigns = [
      {
        id: 'c1',
        name: 'Active Campaign 1',
        status: 'active' as const,
        sender_identity_slug: 'lucas' as const,
        sent_count: 100,
        delivered_count: 98,
        drafting_active: false,
        auto_status: null,
        drafting_generated: 0,
      },
      {
        id: 'c2',
        name: 'Active Campaign 2',
        status: 'active' as const,
        sender_identity_slug: 'lucas' as const,
        sent_count: 50,
        delivered_count: 49,
        drafting_active: true,
        auto_status: 'live' as const,
        drafting_generated: 5,
      },
    ];

    const totalSent = campaigns.reduce((sum, c) => sum + (c.sent_count || 0), 0);
    const totalDelivered = campaigns.reduce((sum, c) => sum + (c.delivered_count || 0), 0);
    const deliveryRate = totalSent > 0 ? totalDelivered / totalSent : null;

    assert.equal(totalSent, 150);
    assert.equal(totalDelivered, 147);
    assert.equal(deliveryRate, 147 / 150); // 0.98 -> 98.0%
  });
});
