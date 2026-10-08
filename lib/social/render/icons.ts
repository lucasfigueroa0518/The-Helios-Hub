/**
 * The Helios icon set for icon backgrounds (photo spec §5; Tommy,
 * 2026-10-07): open-source outline icons from Lucide (ISC licence). The
 * Writer names one per slide and per cover option; it is drawn whenever no
 * photo is found, and always on stat slides. Code checks the name is here.
 */
import {
  Banknote, Bot, Briefcase, Building2, Calendar, Clock, Code, Cpu, Eye, Factory, FileText, Gavel, Globe, GraduationCap,
  Handshake, HeartPulse, Landmark, Lock, MessageSquareQuote, Newspaper, Rocket, Scale, Search, Server, Shield, Smartphone,
  TriangleAlert, User, Users, Zap, type LucideIcon,
} from 'lucide-react';

/** Name (what the Writer writes) → icon, with what it's for (shown to the Writer). */
export const ICONS: Record<string, { icon: LucideIcon; for: string }> = {
  clock: { icon: Clock, for: 'a deadline, time, speed' },
  calendar: { icon: Calendar, for: 'a date, a schedule' },
  shield: { icon: Shield, for: 'security, safety, protection' },
  lock: { icon: Lock, for: 'privacy, access limits, lock-in' },
  'heart-pulse': { icon: HeartPulse, for: 'health, medicine' },
  cpu: { icon: Cpu, for: 'chips, compute, a model' },
  server: { icon: Server, for: 'data centers, infrastructure' },
  code: { icon: Code, for: 'software, developers, code' },
  smartphone: { icon: Smartphone, for: 'apps, phones, consumers' },
  user: { icon: User, for: 'one person, a user' },
  users: { icon: Users, for: 'people, users, staff, the public' },
  'building-2': { icon: Building2, for: 'a company, an office' },
  landmark: { icon: Landmark, for: 'government, a regulator' },
  scale: { icon: Scale, for: 'law, fairness, a trade-off' },
  gavel: { icon: Gavel, for: 'a court, a ruling, a lawsuit' },
  banknote: { icon: Banknote, for: 'money, price, funding' },
  briefcase: { icon: Briefcase, for: 'jobs, business, work' },
  globe: { icon: Globe, for: 'countries, global reach' },
  rocket: { icon: Rocket, for: 'a launch, a release' },
  zap: { icon: Zap, for: 'power, energy, a sudden change' },
  'file-text': { icon: FileText, for: 'a document, a report, a policy' },
  'message-square-quote': { icon: MessageSquareQuote, for: 'a statement, a quote' },
  'graduation-cap': { icon: GraduationCap, for: 'education, students, research' },
  factory: { icon: Factory, for: 'manufacturing, industry' },
  search: { icon: Search, for: 'search, an investigation' },
  eye: { icon: Eye, for: 'surveillance, oversight, visibility' },
  bot: { icon: Bot, for: 'an AI assistant, an agent' },
  newspaper: { icon: Newspaper, for: 'the news, the press, a report' },
  handshake: { icon: Handshake, for: 'a deal, a partnership' },
  'triangle-alert': { icon: TriangleAlert, for: 'a risk, a warning, a failure' },
};

export const ICON_NAMES = Object.keys(ICONS);

/** When a draft names no valid icon (older drafts; a final attempt that still failed). */
export const DEFAULT_ICON = 'newspaper';

export const isIcon = (name: string | null | undefined): name is string => Boolean(name && name in ICONS);

/** The list as the Writer sees it: "clock (a deadline, time, speed); …". */
export const ICON_LIST_FOR_WRITER = ICON_NAMES.map((n) => `${n} (${ICONS[n]!.for})`).join('; ');
