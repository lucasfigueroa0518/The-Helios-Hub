/**
 * The Helios starter set (spec §5.1a, order step 4): hand-picked generic
 * photos stored in the repo (public/social/starter), the last step of the
 * photo chain. Offline: no network, so no slide is ever empty even when
 * every online source fails (Tommy, 2026-10-05).
 *
 * Rules for an entry (Tommy, 2026-10-06):
 *   - a scene or object, never a person (checked by eye before adding);
 *   - no brand logos;
 *   - a verifiable credit: Wikimedia Commons, CC0 or public domain, with the
 *     file page recorded so anyone can check author and licence.
 * Must hold at least MAX_PHOTOS_PER_POST entries, so the no-repeat rule can
 * always be met.
 */
import type { Photo } from './find';

/** Cover + up to 8 story slides (spec: 5–8 story slides). */
export const MAX_PHOTOS_PER_POST = 9;

export type StarterPhoto = {
  file: string;
  shows: string;
  width: number;
  height: number;
  author: string;
  license: 'CC0' | 'Public domain';
  /** The Commons file page: author and licence are verifiable there. */
  page: string;
};

export const STARTER_SET: StarterPhoto[] = [
  { file: 'data-center-roof.jpg', shows: 'data center rooftop with rows of cooling units, at dusk', width: 2560, height: 1920, author: 'Rsparks3', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Data_center_roof.jpg' },
  { file: 'city-skyline-night.jpg', shows: 'city skyline at night', width: 2560, height: 1920, author: 'RFNirmala', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Quezon_City_skyline_at_night_10Sep2025.jpg' },
  { file: 'circuit-board.jpg', shows: 'green circuit board close-up', width: 2560, height: 1920, author: 'ComputerUserUser', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Caviar_2340_Hard_Drive_Circuit_Board_Side_1.jpg' },
  { file: 'nyc-from-orbit.jpg', shows: 'New York City at night from the ISS', width: 2560, height: 1707, author: 'NASA', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:ISS-53_New_York_City,_Night_Lights.jpg' },
  { file: 'black-keyboard.jpg', shows: 'black computer keyboard on a desk', width: 2560, height: 1920, author: 'Samiknoov', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Black_Computer_keyboard.jpg' },
  { file: 'us-capitol-night.jpg', shows: 'US Capitol building at night', width: 2560, height: 1932, author: 'Diliff', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:US_Capitol_Building_at_night_Jan_2006.jpg' },
  { file: 'earth-night-iss.jpg', shows: 'Earth at night through a fisheye lens from the ISS', width: 2560, height: 2560, author: 'NASA', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:ISS-46_Fisheye_lens_night_view_of_the_Earth.jpg' },
  { file: 'keyboard-close-up.jpg', shows: 'silver keyboard keys close-up', width: 2560, height: 1373, author: 'Alexander-design', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Keyboard_Close_Up.jpg' },
  { file: 'bay-area-from-orbit.jpg', shows: 'San Francisco Bay Area at night from the ISS', width: 2560, height: 1703, author: 'NASA', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:ISS-34_Night_image_of_the_Bay_Area_of_California.jpg' },
  { file: 'chicago-from-orbit.jpg', shows: 'Chicago street grid at night from the ISS', width: 2560, height: 1704, author: 'NASA', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:ISS-47_Chicago_night_view.jpg' },
];

export const starterUrl = (file: string) => `/social/starter/${file}`;

/** Same short form as Commons subject photos: "NASA (public domain) · Wikimedia Commons". */
export const starterCredit = (p: StarterPhoto) => `${p.author} (${p.license === 'CC0' ? 'CC0' : 'public domain'}) · Wikimedia Commons`;

/** The first starter photo not yet used in this post. */
export function pickStarter(used: Set<string>): Photo | null {
  const s = STARTER_SET.find((p) => !used.has(starterUrl(p.file)));
  return s ? { url: starterUrl(s.file), credit: starterCredit(s), source: 'starter', width: s.width, height: s.height, qid: null, subject: null } : null;
}
