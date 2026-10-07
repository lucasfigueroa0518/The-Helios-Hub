/**
 * The Helios starter set (spec §5.1a, order step 4): hand-picked photos
 * stored in the repo (public/social/starter), the last step of the photo
 * chain. Offline, so no slide is ever empty even when every online source
 * fails.
 *
 * Rules for an entry (Tommy, 2026-10-06; reviewed photo by photo):
 *   - literal, neutral scenes or objects only: no people, no logos, no
 *     recognizable place or landmark, no mood imagery (clocks, hourglasses,
 *     rain);
 *   - a verifiable credit: Wikimedia Commons, CC0 or public domain, with the
 *     file page recorded so anyone can check author and licence;
 *   - checked by eye, the face detector (0 faces) and Jev's pre-screen
 *     (people < 0.3).
 *
 * Every photo is story-specific (Tommy, 2026-10-06: a photo has to fit the
 * story it lands in). Each carries topic tags, and a slide gets one only
 * when a tag matches, per slide (plain-word matching, no judgment):
 *   1. the slide's IMAGE request ("stock: server room corridor");
 *   2. the brief's main topic (THE NEWS);
 *   3. else the AI-compute photos, logged as no-topic-match.
 * When every photo of the matched tier was used in the last 7 days, the
 * least recently used one is reused and logged as starter-pool-exhausted:
 * the chain never fails to return a photo.
 */
import type { Brief } from '@/lib/social/reporter/brief';

import type { Photo } from './find';

/** Cover + up to 8 story slides (spec: 5–8 story slides). */
export const MAX_PHOTOS_PER_POST = 9;

export const TOPICS = [
  'AI compute and data centers', 'Chips and semiconductors', 'Software and coding', 'Phones and consumer apps', 'Energy and power',
  'Space and satellites', 'Robotics and automation', 'Research and labs', 'Money, funding and business', 'Trade and supply chain',
  'Security and hacking', 'Cities and infrastructure', 'Jobs and the workplace', 'Education', 'Copyright, publishing and training data',
  'US Congress', 'stock markets', 'surveillance',
] as const;
export type StarterTopic = (typeof TOPICS)[number];

/** The default when nothing matches: every post is AI news. */
export const DEFAULT_TOPIC: StarterTopic = 'AI compute and data centers';

export type StarterPhoto = {
  file: string;
  shows: string;
  width: number;
  height: number;
  author: string;
  license: 'CC0' | 'Public domain';
  /** The Commons file page: author and licence are verifiable there. */
  page: string;
  /** Used only when one of these matches the slide or the story. */
  topics: StarterTopic[];
};

export const STARTER_SET: StarterPhoto[] = [
  { file: 'data-center-roof.jpg', shows: 'data center rooftop with rows of cooling units, at dusk', width: 2048, height: 1536, author: 'Rsparks3', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Data_center_roof.jpg', topics: ['AI compute and data centers'] },
  { file: 'city-skyline-night.jpg', shows: 'city skyline at night', width: 2048, height: 1536, author: 'RFNirmala', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Quezon_City_skyline_at_night_10Sep2025.jpg', topics: ['Cities and infrastructure'] },
  { file: 'circuit-board.jpg', shows: 'green circuit board close-up', width: 2048, height: 1536, author: 'ComputerUserUser', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Caviar_2340_Hard_Drive_Circuit_Board_Side_1.jpg', topics: ['AI compute and data centers', 'Chips and semiconductors'] },
  { file: 'black-keyboard.jpg', shows: 'black computer keyboard on a desk', width: 2048, height: 1536, author: 'Samiknoov', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Black_Computer_keyboard.jpg', topics: ['Software and coding'] },
  { file: 'earth-night-iss.jpg', shows: 'Earth at night through a fisheye lens from the ISS', width: 2048, height: 2048, author: 'NASA', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:ISS-46_Fisheye_lens_night_view_of_the_Earth.jpg', topics: ['Space and satellites'] },
  { file: 'keyboard-close-up.jpg', shows: 'silver keyboard keys close-up', width: 2048, height: 1098, author: 'Alexander-design', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Keyboard_Close_Up.jpg', topics: ['Software and coding'] },
  { file: 'us-capitol-night.jpg', shows: 'US Capitol building at night', width: 2048, height: 1546, author: 'Diliff', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:US_Capitol_Building_at_night_Jan_2006.jpg', topics: ['US Congress'] },
  { file: 'circuit-board-etched-circuit-board-aft.jpg', shows: 'circuit board', width: 2048, height: 1213, author: 'Tinux', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Etched_circuit_board_after_cleaning.jpg', topics: ['AI compute and data centers', 'Chips and semiconductors'] },
  { file: 'microchip-hitachi-hd61700-micropro.jpg', shows: 'microchip', width: 2048, height: 2048, author: 'Piotr433', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Hitachi_HD61700_microprocessor_top_metal_die_shot.jpg', topics: ['AI compute and data centers', 'Chips and semiconductors'] },
  { file: 'computer-screen-code-css-code-on-a-screen-uns.jpg', shows: 'computer screen code', width: 2048, height: 1366, author: 'Sai Kiran Anagani _imkiran', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:CSS_code_on_a_screen_(Unsplash).jpg', topics: ['Software and coding'] },
  { file: 'computer-screen-code-rustcodeonscreen.jpg', shows: 'computer screen code', width: 1523, height: 1438, author: 'Slashme', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:RustCodeOnScreen.jpg', topics: ['Software and coding'] },
  { file: 'satellite-dish-satellite-antenna-skywar.jpg', shows: 'satellite dish', width: 2048, height: 1154, author: 'Galen Crout galen_crout', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Satellite_Antenna_Skyward_(Unsplash).jpg', topics: ['Space and satellites'] },
  { file: 'power-lines-anchor-pylon-of-high-vol.jpg', shows: 'power lines', width: 2048, height: 1536, author: 'Novoklimov', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Anchor_pylon_of_high-voltage_overhead_power_line_750_kV.jpg', topics: ['Energy and power'] },
  { file: 'power-lines-electric-transmission-po.jpg', shows: 'power lines', width: 2048, height: 1366, author: 'Foto3821', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Electric_transmission_power_tower.jpg', topics: ['Energy and power'] },
  { file: 'wind-turbines-vierwies-wind-farm-seen-.jpg', shows: 'wind turbines', width: 1366, height: 2048, author: 'DimiTalen', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Vierwies_wind_farm,_seen_from_a_hot_air_balloon,_Zele,_2026.jpg', topics: ['Energy and power'] },
  { file: 'wind-turbines-sunset-and-wind-turbines.jpg', shows: 'wind turbines', width: 2048, height: 1536, author: 'Pragdon', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Sunset_and_wind_turbines_at_Akhisar_Train_Station.jpg', topics: ['Energy and power'] },
  { file: 'earth-from-space-gigantic-jet-photographe.jpg', shows: 'earth from space', width: 2048, height: 1366, author: 'NASA/Nichole Ayers', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Gigantic_jet_photographed_by_Nichole_Ayers_on_the_International_Space_Station,_some_edits.jpg', topics: ['Space and satellites'] },
  { file: 'office-tower-oakland-skyscraper-mirro.jpg', shows: 'office tower', width: 1536, height: 2048, author: 'TheMue', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Oakland_Skyscraper_Mirroring_Reflection_Facade.jpg', topics: ['Jobs and the workplace', 'Money, funding and business'] },
  { file: 'coins-a-pile-of-ukrainian-curr.jpg', shows: 'coins', width: 2048, height: 1536, author: 'Роман Рябенко', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:A_pile_of_Ukrainian_currency_coins.jpg', topics: ['Money, funding and business'] },
  { file: 'padlock-padlock-valimokatu-oulu-.jpg', shows: 'padlock', width: 2048, height: 1538, author: 'Estormiz', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Padlock_Valimokatu_Oulu_20250307_02.jpg', topics: ['Security and hacking'] },
  { file: 'library-bookshelves-in-hove-libr.jpg', shows: 'library', width: 1542, height: 2048, author: 'Andy Li', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Bookshelves_in_Hove_Library_2025-08-20.jpg', topics: ['Copyright, publishing and training data'] },
  { file: 'solar-panels-solar-array-3.jpg', shows: 'solar panels', width: 2048, height: 1536, author: 'Wikideas1', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Solar_array-3.jpg', topics: ['Energy and power'] },
  { file: 'empty-conference-room-small-conference-room-un.jpg', shows: 'empty conference room', width: 2048, height: 931, author: 'Crew crew', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Small_conference_room_(Unsplash).jpg', topics: ['Jobs and the workplace', 'Money, funding and business'] },
  { file: 'empty-lecture-hall-gfp-lecture-hall.jpg', shows: 'empty lecture hall', width: 2048, height: 1366, author: 'Yinan Chen', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Gfp-lecture-hall.jpg', topics: ['Education'] },
  { file: 'highway-at-night-tel-aviv-long-exposure-p.jpg', shows: 'highway at night', width: 2048, height: 1356, author: 'Equalhuman', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Tel_aviv_long_exposure_public_domain_1.jpg', topics: ['Cities and infrastructure'] },
  { file: 'container-port-aerial-view-of-shipping-.jpg', shows: 'container port', width: 2048, height: 1366, author: 'Brian Harris', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Aerial_view_of_shipping_containers,_and_big_container_cranes_at_Tacoma%27s_container_port_-a.jpg', topics: ['Trade and supply chain'] },
  { file: 'warehouse-fema-37526-florida-logis.jpg', shows: 'warehouse', width: 2048, height: 1360, author: 'Barry Bahler', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:FEMA_-_37526_-_Florida_Logisitics_Response_center.jpg', topics: ['Trade and supply chain'] },
  { file: 'smartphone-white-work-table-with-no.jpg', shows: 'smartphone', width: 2048, height: 1366, author: 'JESHOOTS.COM jeshoots', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:White_work_table_with_notes,_smartphone_and_laptop_(Unsplash).jpg', topics: ['Phones and consumer apps', 'Jobs and the workplace'] },
  { file: 'smartphone-iphone-macbook-and-smart.jpg', shows: 'smartphone', width: 2048, height: 1366, author: 'Alejandro Escamilla alejandroescamilla', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Iphone,_macbook_and_smartphone_on_a_table_(Unsplash).jpg', topics: ['Phones and consumer apps'] },
  { file: 'city-skyline-vang-vieng-skyline-at-du.jpg', shows: 'city skyline', width: 2048, height: 1536, author: 'Shenzybaby', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Vang_Vieng_skyline_at_dusk_2026_06_07.jpg', topics: ['Cities and infrastructure'] },
  { file: 'chip-wafer-micro-chips-wafer-83846.jpg', shows: 'chip wafer', width: 2048, height: 1536, author: 'Syced', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Micro-chips_wafer_(83846).jpg', topics: ['AI compute and data centers', 'Chips and semiconductors'] },
  { file: 'chip-wafer-micro-chips-wafer-69536.jpg', shows: 'chip wafer', width: 2048, height: 1536, author: 'Syced', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Micro-chips_wafer_(69536).jpg', topics: ['AI compute and data centers', 'Chips and semiconductors'] },
  { file: 'chip-wafer-micro-chips-wafer-25079.jpg', shows: 'chip wafer', width: 2048, height: 1536, author: 'Syced', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Micro-chips_wafer_(25079).jpg', topics: ['AI compute and data centers', 'Chips and semiconductors'] },
  { file: 'lab-bench-laminar-flow-hood-2.jpg', shows: 'lab bench', width: 2048, height: 1152, author: 'TimVickers', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Laminar_flow_hood_2.jpg', topics: ['Research and labs'] },
  { file: 'lab-bench-uv-ontsmetting-laminaire.jpg', shows: 'lab bench', width: 2048, height: 1536, author: 'Newbie~commonswiki', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:UV-ontsmetting_laminaire-vloeikast.JPG', topics: ['Research and labs'] },
  { file: 'data-center-aisle-rear-of-hopper-cray-xe6-.jpg', shows: 'data center aisle', width: 1360, height: 2048, author: 'Derrick Coetzee from Berkeley, CA, USA', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:Rear_of_Hopper_Cray_XE6_racks.jpg', topics: ['AI compute and data centers'] },
  { file: 'robot-arm-factory-automation-robot.jpg', shows: 'robot arm', width: 2048, height: 1536, author: 'KUKA Roboter GmbH, Bachmann', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Factory_Automation_Robotics_Palettizing_Bread.jpg', topics: ['Robotics and automation'] },
  { file: 'robot-arm-hoops-basketball-robotic.jpg', shows: 'robot arm', width: 1536, height: 2048, author: 'Photojunkie', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Hoops_Basketball_Robotic_Arm.JPG', topics: ['Robotics and automation'] },
  { file: 'government-building-capitol-building-full-vi.jpg', shows: 'government building', width: 2048, height: 878, author: 'Noclip', license: 'Public domain', page: 'https://commons.wikimedia.org/wiki/File:Capitol_Building_Full_View.jpg', topics: ['US Congress'] },
  { file: 'stock-exchange-new-york-stock-exchange-.jpg', shows: 'stock exchange', width: 2048, height: 1678, author: 'Balon Greyjoy', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:New_York_Stock_Exchange_Entrance.jpg', topics: ['stock markets'] },
  { file: 'camera-cctv-cameras-in-mumbai.jpg', shows: 'camera', width: 2048, height: 1024, author: 'Punit Rajpal', license: 'CC0', page: 'https://commons.wikimedia.org/wiki/File:CCTV_cameras_in_Mumbai.jpg', topics: ['surveillance'] },
];

/**
 * Plain words that put a text on a topic (literal terms only, Tommy
 * 2026-10-06). AI-compute words are deliberately narrow (no bare "AI"), so
 * the default is a real fallback, not every match.
 */
export const TOPIC_TERMS: Record<StarterTopic, RegExp> = {
  'AI compute and data centers': /\b(data cent(?:er|re)s?|servers?|server rooms?|server racks?|compute|computing power|GPUs?|supercomputers?|cloud computing)\b/i,
  'Chips and semiconductors': /\b(chips?|semiconductors?|wafers?|microchips?|processors?|foundr(?:y|ies)|TSMC|export controls?)\b/i,
  'Software and coding': /\b(code|coding|software|developers?|programming|programmers?|keyboards?|open[- ]source)\b/i,
  'Phones and consumer apps': /\b(phones?|smartphones?|iPhones?|Android|apps?|mobile)\b/i,
  'Energy and power': /\b(energy|electricity|power grids?|power plants?|nuclear|solar|wind (?:farms?|turbines?|power)|utility companies|utilities|pylons?|power lines?)\b/i,
  'Space and satellites': /\b(outer space|spaceflight|space station|satellites?|orbit(?:al)?|rockets?|NASA|SpaceX|Starlink|ISS)\b/i,
  'Robotics and automation': /\b(robots?|robotics|robotic|automation|humanoids?|factor(?:y|ies)|manufacturing)\b/i,
  'Research and labs': /\b(laborator(?:y|ies)|scientists?|experiments?)\b/i,
  'Money, funding and business': /\b(funding|fundraising|funding rounds?|investments?|investors?|valuation|revenue|profits?|money|prices?|pricing|subscriptions?|coins?|cash)\b/i,
  'Trade and supply chain': /\b(trade|tariffs?|exports?|imports?|supply chains?|shipping|seaports?|shipping containers?|warehouses?|logistics)\b/i,
  'Security and hacking': /\b(security|hacks?|hackers?|hacking|breach(?:es)?|cyber\w*|vulnerabilit(?:y|ies)|passwords?|padlocks?)\b/i,
  'Cities and infrastructure': /\b(cit(?:y|ies)|skylines?|urban|highways?|traffic|infrastructure|roads?)\b/i,
  'Jobs and the workplace': /\b(jobs?|workers?|workplaces?|employees?|employers?|employment|layoffs?|hiring|unions?)\b/i,
  Education: /\b(education|schools?|students?|universit(?:y|ies)|teachers?|classrooms?|lectures?|lecture halls?)\b/i,
  'Copyright, publishing and training data': /\b(copyright\w*|publishers?|publishing|authors?|books?|librar(?:y|ies)|training data|licensing deals?)\b/i,
  'US Congress': /\b(Congress|congressional|U\.?S\.? Senate|senators?|House of Representatives|Capitol Hill|Speaker of the House)\b/i,
  'stock markets': /\b(stock markets?|stock prices?|shares (?:fell|rose|jumped|dropped|slid|surged)|Nasdaq|NYSE|S&P 500|Dow Jones|IPO|market value|market cap(?:italization)?)\b/i,
  surveillance: /\b(surveillance|facial recognition|CCTV|spyware|spying)\b/i,
};

/** Words never used for matching: they mean something else in AI news (Tommy, 2026-10-06). Guarded by a test. */
export const AMBIGUOUS_WORDS = ['lab', 'labs', 'model', 'models', 'agent', 'agents', 'research', 'researcher', 'space', 'raised', 'deal', 'port', 'container', 'lock', 'utility', 'office', 'meeting'];

/** Topics a text is about. */
export function topicsIn(text: string): StarterTopic[] {
  return TOPICS.filter((t) => TOPIC_TERMS[t].test(text));
}

/** The brief's main topic(s): from THE NEWS. */
export function briefTopics(brief: Brief | null): StarterTopic[] {
  return brief ? topicsIn(brief.the_news.text) : [];
}

export const starterUrl = (file: string) => `/social/starter/${file}`;

/** Same short form as Commons subject photos: "NASA (public domain) · Wikimedia Commons". */
export const starterCredit = (p: StarterPhoto) => `${p.author} (${p.license === 'CC0' ? 'CC0' : 'public domain'}) · Wikimedia Commons`;

const toPhoto = (s: StarterPhoto): Photo => ({ url: starterUrl(s.file), credit: starterCredit(s), source: 'starter', width: s.width, height: s.height, qid: null, subject: null });

export type StarterMatch = 'request' | 'brief' | 'no-topic-match';

/** The tiers to try for a slide, most specific first; empty tiers are skipped. */
function tiers(request: string, brief: Brief | null): Array<{ match: StarterMatch; photos: StarterPhoto[] }> {
  const withTopic = (ts: StarterTopic[]) => STARTER_SET.filter((p) => p.topics.some((t) => ts.includes(t)));
  return [
    { match: 'request' as const, photos: withTopic(topicsIn(request)) },
    { match: 'brief' as const, photos: withTopic(briefTopics(brief)) },
    { match: 'no-topic-match' as const, photos: withTopic([DEFAULT_TOPIC]) },
  ].filter((t) => t.photos.length > 0);
}

/** The first matching starter photo not in `avoid` (this post + the last 7 days), and which tier matched. */
export function pickStarter(avoid: Set<string>, slide: { request: string; brief: Brief | null }): { photo: Photo; match: StarterMatch } | null {
  for (const t of tiers(slide.request, slide.brief)) {
    const s = t.photos.find((p) => !avoid.has(starterUrl(p.file)));
    if (s) return { photo: toPhoto(s), match: t.match };
  }
  return null;
}

/**
 * starter-pool-exhausted: every photo of every matching tier was used in the
 * last 7 days. The least recently used one of the most specific tier that
 * still has a photo not in this post; a photo is never repeated within a
 * post, so a post that uses up a tier widens to the AI-compute default, then
 * Software and coding, then any starter photo. Never null.
 */
export function pickStarterLeastRecent(usedThisPost: Set<string>, lastUsed: Map<string, string>, slide: { request: string; brief: Brief | null }): { photo: Photo; match: StarterMatch } {
  const age = (p: StarterPhoto) => lastUsed.get(starterUrl(p.file)) ?? '';
  const widen: Array<{ match: StarterMatch; photos: StarterPhoto[] }> = [
    ...tiers(slide.request, slide.brief),
    { match: 'no-topic-match', photos: STARTER_SET.filter((p) => p.topics.includes('Software and coding')) },
    { match: 'no-topic-match', photos: STARTER_SET },
  ];
  for (const t of widen) {
    const free = t.photos.filter((p) => !usedThisPost.has(starterUrl(p.file))).sort((a, b) => age(a).localeCompare(age(b)));
    if (free[0]) return { photo: toPhoto(free[0]), match: t.match };
  }
  const oldest = [...STARTER_SET].sort((a, b) => age(a).localeCompare(age(b)))[0]!;
  return { photo: toPhoto(oldest), match: 'no-topic-match' };
}
