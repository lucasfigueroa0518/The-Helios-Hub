export type IndustryDef = {
  slug: string;
  label: string;
  keywords: string[];
};

export const INDUSTRIES: IndustryDef[] = [
  {
    slug: 'real_estate',
    label: 'Real Estate',
    keywords: ['real estate', 'realtor', 'realtors', 'brokerage', 'nar ', 'mls', 'commercial real estate', 'cre ', 'proptech'],
  },
  {
    slug: 'law',
    label: 'Law Firms',
    keywords: ['law firm', 'lawyer', 'attorneys', 'bar association', 'legal tech', 'legaltech', 'counsel', 'litigation'],
  },
  {
    slug: 'financial_services',
    label: 'Financial Services',
    keywords: ['financial services', 'fintech', 'banker', 'banking', 'payments', 'lending', 'cfo '],
  },
  {
    slug: 'hospitality_nightlife',
    label: 'Hospitality & Nightlife',
    keywords: ['hospitality', 'nightlife', 'restaurant', 'restaurateur', 'hotel', 'hotelier', 'bar owner', 'foodservice'],
  },
  {
    slug: 'accounting_tax',
    label: 'Accounting & Tax Advisory',
    keywords: ['accounting', 'accountant', 'cpa ', 'tax advisory', 'tax advisor', 'bookkeeping'],
  },
  {
    slug: 'wealth_rias',
    label: 'Wealth Management / RIAs',
    keywords: ['wealth management', 'ria', 'registered investment', 'financial advisor', 'private wealth', 'family office'],
  },
  {
    slug: 'insurance',
    label: 'Insurance',
    keywords: ['insurance', 'insurtech', 'broker', 'agency', 'underwriter', 'benefits broker'],
  },
  {
    slug: 'architecture_design',
    label: 'Architecture & Design',
    keywords: ['architecture', 'architect', 'interior design', 'aia ', 'design firm'],
  },
  {
    slug: 'engineering_construction',
    label: 'Engineering & Construction',
    keywords: ['engineering consulting', 'construction', 'general contractor', 'gc ', 'civil engineer', 'aec '],
  },
  {
    slug: 'healthcare_practices',
    label: 'Healthcare practices',
    keywords: [
      'dental',
      'dentist',
      'medspa',
      'med spa',
      'cosmetic',
      'dermatology',
      'concierge medicine',
      'elective',
      'healthcare practice',
      'clinic',
    ],
  },
  {
    slug: 'home_services',
    label: 'Home services',
    keywords: ['hvac', 'roofing', 'remodeling', 'landscaping', 'home services', 'contractor', 'plumber'],
  },
  {
    slug: 'staffing_recruiting',
    label: 'Staffing & Recruiting',
    keywords: ['staffing', 'recruiting', 'recruiter', 'talent acquisition', 'workforce'],
  },
  {
    slug: 'it_msp',
    label: 'IT/MSP',
    keywords: ['managed service', 'msp', 'it services', 'msps', 'channel partner'],
  },
  {
    slug: 'property_management',
    label: 'Property Management',
    keywords: ['property management', 'property manager', 'hoa ', 'multifamily', 'apartment operator'],
  },
  {
    slug: 'fb_products',
    label: 'F&B Products',
    keywords: ['cpg', 'food brand', 'beverage brand', 'f&b', 'consumer packaged', 'grocery buyer'],
  },
  {
    slug: 'beauty',
    label: 'Beauty & Personal Care',
    keywords: ['beauty', 'skincare', 'cosmetics', 'personal care', 'salon owner'],
  },
  {
    slug: 'supplements_wellness',
    label: 'Supplements & Wellness',
    keywords: ['supplement', 'wellness brand', 'nutraceutical', 'vitamins'],
  },
  {
    slug: 'apparel_footwear',
    label: 'Apparel & Footwear',
    keywords: ['apparel', 'footwear', 'fashion brand', 'clothing brand'],
  },
  {
    slug: 'home_goods',
    label: 'Home Goods / Furniture',
    keywords: ['home goods', 'furniture', 'furnishings', 'housewares'],
  },
  {
    slug: 'pet_products',
    label: 'Pet Products',
    keywords: ['pet product', 'pet brand', 'pettech', 'veterinary'],
  },
  {
    slug: 'beverage',
    label: 'Beverage',
    keywords: ['rtd cocktail', 'non-alc', 'functional beverage', 'craft beer', 'winery', 'spirits brand', 'alcohol brand'],
  },
  {
    slug: 'fitness_gyms',
    label: 'Fitness & Gyms',
    keywords: ['gym', 'boutique studio', 'fitness studio', 'personal trainer', 'pilates', 'boutique fitness'],
  },
  {
    slug: 'automotive',
    label: 'Automotive',
    keywords: ['dealership', 'auto detailing', 'aftermarket', 'ev dealer', 'automotive'],
  },
  {
    slug: 'education',
    label: 'Education',
    keywords: ['tutoring', 'edtech', 'cert program', 'bootcamp', 'training program'],
  },
  {
    slug: 'travel_experiences',
    label: 'Travel & Experiences',
    keywords: ['tour operator', 'boutique hospitality', 'travel brand', 'experiences operator'],
  },
];

export const TECH_KEYWORDS = [
  'artificial intelligence',
  ' ai ',
  'ai/',
  '/ai',
  'machine learning',
  ' llm',
  'llms',
  'genai',
  'generative ai',
  'startup',
  'startups',
  'founder',
  'founders',
  'venture',
  'vc ',
  'developer',
  'developers',
  'hackathon',
  'gdg',
  'masstlc',
  'mtlc',
  'tech meetup',
  'tech mixer',
  'python',
  'javascript',
  'typescript',
  'devops',
  'saas',
  'software',
  'product hunt',
  'y combinator',
  'accelerator',
  'demo day',
  'build in public',
  'open source',
  'data science',
  'mlops',
  'prompt',
  'cursor',
  'anthropic',
  'openai',
  'huggingface',
  'hugging face',
  'nvidia',
  'aws ',
  'google cloud',
  'azure',
  'engineer',
  'engineering meetup',
];

export const FORMAT_KEEP_KEYWORDS = [
  'meetup',
  'mixer',
  'happy hour',
  'dinner',
  'reception',
  'roundtable',
  'conference',
  'summit',
  'hackathon',
  'expo',
  'trade show',
  'tradeshow',
  'networking',
  'salon',
  'breakfast',
  'lunch',
  'gathering',
  'panel',
  'demo day',
  'pitch night',
  'pitch competition',
  'workshop',
  'forum',
  'after hours',
];

export const FORMAT_DROP_KEYWORDS = [
  'webinar',
  'virtual only',
  'livestream',
  'live stream',
  'zoom only',
  'concert',
  'music festival',
  'festival',
  'sports game',
  'watch party',
  'family fair',
  'comedy show',
  'stand-up',
  'karaoke',
  'dj night',
  'club night',
  'rave',
  'yoga class',
  'run club',
];

export const INVITE_KEYWORDS = [
  'invite only',
  'invitation only',
  'invite-only',
  'application required',
  'apply to attend',
  'request an invite',
  'request invite',
  'request access',
  'guest list',
  'members only',
  'member-only',
  'approval required',
  'requires approval',
  'by invitation',
];

export function haystackOf(parts: Array<string | undefined>): string {
  return ` ${parts.filter(Boolean).join(' ').toLowerCase()} `;
}

export function matchesAny(haystack: string, keywords: string[]): boolean {
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

export function matchingIndustries(haystack: string): string[] {
  return INDUSTRIES.filter((industry) => matchesAny(haystack, industry.keywords)).map(
    (industry) => industry.slug,
  );
}

export function matchesTech(haystack: string): boolean {
  if (matchesAny(haystack, TECH_KEYWORDS)) return true;
  return /\bai\b/.test(haystack);
}
