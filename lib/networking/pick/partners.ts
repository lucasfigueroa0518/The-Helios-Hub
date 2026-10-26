/**
 * Helios partner hosts (AE-27). A partner's event always qualifies, skipping the gates and the
 * history bar, and goes to the top of its city's week, ordered among partners by score. Matched
 * on the organizer, host and calendar names (`rosterNames`), and on the title for series whose
 * listings are often posted by a person rather than the organization.
 */
import type { Metro, StoredNetworkingEvent } from '@/lib/networking/types';

import { normalizeOrgName } from './anchors-roster';
import { rosterNames } from './terms';

type Partner = { name: string; metros: readonly Metro[]; names: readonly string[]; titles?: readonly string[] };

export const PARTNERS: readonly Partner[] = [
  { name: 'eMerge Americas', metros: ['miami'], names: ['emerge americas', 'emergeamericas'] },
  { name: 'Miami AI Hub', metros: ['miami'], names: ['miami ai hub', 'miamiaihub'] },
  {
    name: 'South Miami Tech Tuesdays',
    metros: ['miami'],
    names: ['purple horizons', 'purplehorizons', 'south miami tech tuesdays', 'southmiamitechtuesdays'],
    titles: ['south miami tech tuesday'],
  },
  { name: 'Burhan Sebin', metros: ['miami'], names: ['burhan sebin'] },
  { name: 'Melissa Medina', metros: ['miami'], names: ['melissa medina'] },
  { name: 'Tony Jimenez', metros: ['miami'], names: ['tony jimenez'] },
];

type PartnerSignals = Pick<StoredNetworkingEvent, 'metro' | 'title' | 'organizerName' | 'hostName' | 'hosts' | 'signals'>;

/** The partner hosting the event, or null. A name matches when it equals or contains a partner name. */
export function partnerMatch(event: PartnerSignals): string | null {
  const names = rosterNames(event).map(normalizeOrgName);
  const title = normalizeOrgName(event.title ?? '');
  for (const p of PARTNERS) {
    if (!p.metros.includes(event.metro)) continue;
    const keys = p.names.map(normalizeOrgName);
    if (names.some((n) => keys.some((k) => n === k || ` ${n} `.includes(` ${k} `)))) return p.name;
    if (p.titles?.some((t) => ` ${title} `.includes(` ${normalizeOrgName(t)} `))) return p.name;
  }
  return null;
}
