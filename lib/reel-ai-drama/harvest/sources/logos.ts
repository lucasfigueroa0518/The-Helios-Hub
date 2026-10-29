import path from 'node:path';

import { bluePlayer, BLUE_CHIP_PLAYERS } from '@/lib/social-hub/blue-chip-players';
import { logoFor, logoForPlayer } from '@/lib/social-hub/logo-bank';

import type { Source } from '../types';

/**
 * The logo bank (`lib/social-hub/logo-bank.ts`). A company's banked logo is its character image: the
 * mark that stands for it wherever it appears, so it is exempt from the 20-day rule like a person's
 * cutout (MD-41, MD-45).
 */
export const logoSource: Source = async (want, run) => {
  const name = want.terms.toLowerCase();
  const player = (want.playerId ? bluePlayer(want.playerId) : undefined) ?? BLUE_CHIP_PLAYERS.find((p) => p.kind === 'company' && [p.name, ...(p.aka ?? [])].some((n) => n.toLowerCase() === name));
  const logo = player ? logoForPlayer(player) : want.playerId ? logoFor(want.playerId) : null;
  if (!logo) {
    run.notes.push(`logo bank: no logo for ${want.terms}`);
    return [];
  }
  const root = run.deps.root ?? process.cwd();
  return [
    {
      source: 'logo',
      want: want.id,
      kind: 'logo',
      url: null,
      localFile: path.resolve(root, logo.file),
      source_page: logo.provenance.startsWith('File:') ? `https://commons.wikimedia.org/wiki/${encodeURIComponent(logo.provenance.replace(/ /g, '_'))}` : null,
      credit: logo.credit,
      license: null,
      caption: `${logo.name} logo`,
      people: [],
      qids: logo.qid ? [logo.qid] : [],
      place: null,
      date_taken: null,
      date_basis: 'unknown',
      width: logo.width,
      height: logo.height,
      // A logo has its own flag (MD-41): never a person's character image; it keeps the logos' reuse exemption.
      character_image: false,
      made: false,
      trusted: true,
      shows: `The ${logo.name} logo (${logo.mark ?? 'wordmark'}, on a ${logo.plate} plate).`,
      flags: ['logo_bank', 'logo'],
    },
  ];
};
