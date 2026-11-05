/**
 * What Helios actually published, for the comment lab. A snapshot, refreshed with the command in
 * scripts/personality_seed_posts.sql. The model only ever sees `copy` and `caption`.
 */
import posted from './posted-posts.json';

export const LAB_POST_TYPES = ['Reels', 'Morning Download', 'Explainers', 'Carousels', 'Samples'] as const;
export type LabPostType = (typeof LAB_POST_TYPES)[number];
export type LabPost = { id: string; type: LabPostType; date: string; permalink: string | null; caption: string; copy: string };

/** An explainer's script carries stage directions, and the spoken lines are the indented ones. */
const spokenLines = (script: string) => script.split('\n').filter((l) => l.startsWith('    ')).map((l) => l.trim()).join('\n');

/** Kept by hand, so a refreshed snapshot leaves them alone. These were never published by Helios. */
const SAMPLES: readonly LabPost[] = [
  { id: 'sample-bygga', type: 'Samples', date: '2026', permalink: null, caption: '', copy: 'Bygga turns IKEA manuals into 3D guides\nA developer named Hassan built Bygga, a free app that turns IKEA manuals into interactive 3D assembly guides. It adds voice instructions and a close-up view of every step.' },
  { id: 'sample-airbnb-3d', type: 'Samples', date: '2026', permalink: null, caption: '', copy: 'Claude turned an Airbnb into a 3D tour\nUsing property photos, a floor plan and design references, a creator used Claude, Blender and Unreal Engine to build an explorable 3D version of his Airbnb.' },
];

export const LAB_POSTS: readonly LabPost[] = [
  ...(posted as LabPost[]).map((p) => (p.type === 'Explainers' ? { ...p, copy: spokenLines(p.copy) } : p)),
  ...SAMPLES,
];

export const postsOfType = (type: LabPostType) => LAB_POSTS.filter((p) => p.type === type);
export const postTitle = (post: LabPost) => post.copy.split('\n')[0]!.slice(0, 90);
