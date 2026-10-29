import path from 'node:path';

import { loadCutouts } from '@/lib/real-case/bank';

import type { Source } from '../types';

/**
 * The approved cutout bank (`explainers/real-case/bank/cutouts.json`). A banked cutout is the person's
 * **character image** (MD-41): it may move through the story and is exempt from the 20-day rule (MD-45);
 * any other use of the person needs a different photo.
 */
export const bankSource: Source = async (want, run) => {
  const root = run.deps.root ?? process.cwd();
  const cutouts = run.deps.cutouts ?? loadCutouts(root);
  const name = want.people[0]?.toLowerCase().trim();
  const hit = cutouts.find((c) => c.approved && ((want.playerId && c.id === want.playerId) || want.qids.includes(c.qid) || c.name.toLowerCase() === name));
  if (!hit) return [];
  return [
    {
      source: 'bank',
      want: want.id,
      kind: 'person_photo',
      url: null,
      localFile: path.resolve(root, hit.file),
      source_page: hit.provenance,
      credit: hit.credit,
      license: null,
      caption: `Approved cutout of ${hit.name}`,
      people: [hit.name],
      qids: [hit.qid],
      place: null,
      date_taken: null,
      date_basis: 'unknown',
      width: hit.width,
      height: hit.height,
      character_image: true,
      made: false,
      trusted: true,
      shows: `An approved cutout portrait of ${hit.name} on a transparent background (their character image).`,
      flags: ['cutout'],
    },
  ];
};
