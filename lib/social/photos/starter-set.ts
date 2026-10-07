/**
 * The Helios starter set (spec §5.1 Photo chain v1): photos stored in the
 * repo (public/social/starter), the last step of a COVER's chain only (story
 * slides with nothing usable render text-only). Offline, so a cover is never
 * empty even when every online source fails. Once Tommy approves the
 * branded cover card, it replaces this step.
 *
 * Only the AI-compute photos (DEFAULT_TOPIC) are used, never a topic match:
 * the first one not used in this post, the last 7 days or earlier in the
 * run; when all are, the least recently used one not in this post, logged as
 * starter-pool-exhausted. The other tagged photos stay in the set unused.
 *
 * Rules for an entry (2026-10-06): literal, neutral scenes or objects only (no
 * people, logos, recognizable places or mood imagery); Wikimedia Commons,
 * CC0 or public domain, with the file page recorded.
 */
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

export const starterUrl = (file: string) => `/social/starter/${file}`;

/** Same short form as Commons subject photos: "NASA (public domain) · Wikimedia Commons". */
export const starterCredit = (p: StarterPhoto) => `${p.author} (${p.license === 'CC0' ? 'CC0' : 'public domain'}) · Wikimedia Commons`;

const toPhoto = (s: StarterPhoto): Photo => ({ url: starterUrl(s.file), credit: starterCredit(s), source: 'starter', width: s.width, height: s.height, qid: null, subject: null });

/**
 * The cover's last step: an AI-compute starter photo, never a topic match.
 * The first one not in `avoid` (this post + the last 7 days + earlier in
 * the run); when all are, the least recently used one not in this post.
 * Never null.
 */
export function pickCoverStarter(avoid: Set<string>, usedThisPost: Set<string> = new Set(), lastUsed: Map<string, string> = new Map()): { photo: Photo; exhausted: boolean } {
  const set = STARTER_SET.filter((p) => p.topics.includes(DEFAULT_TOPIC));
  const fresh = set.find((p) => !avoid.has(starterUrl(p.file)));
  if (fresh) return { photo: toPhoto(fresh), exhausted: false };
  const age = (p: StarterPhoto) => lastUsed.get(starterUrl(p.file)) ?? '';
  const lru = [...set].filter((p) => !usedThisPost.has(starterUrl(p.file))).sort((a, b) => age(a).localeCompare(age(b)))[0] ?? set[0]!;
  return { photo: toPhoto(lru), exhausted: true };
}
