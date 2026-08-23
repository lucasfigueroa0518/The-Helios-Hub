'use server';

import { dbQuery } from '@/lib/db';
import { requireTrelloSession } from '@/lib/trello/session';

export type ProfilePatch = {
  firstName?: string;
  lastName?: string;
  role?: string;
  tagline?: string;
  bio?: string;
  timezone?: string;
  pronouns?: string | null;
  availability?: 'available' | 'away';
  hue?: number | null;
  notifyMentions?: boolean;
  notifyAssignments?: boolean;
  notifyDueSoon?: boolean;
  notifyDigest?: boolean;
};

export async function updateProfile(patch: ProfilePatch): Promise<void> {
  const session = await requireTrelloSession();
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [];
  const add = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (typeof patch.firstName === 'string') add('first_name', patch.firstName.trim());
  if (typeof patch.lastName === 'string') add('last_name', patch.lastName.trim());
  if (typeof patch.role === 'string') add('role', patch.role.trim());
  if (typeof patch.tagline === 'string') add('tagline', patch.tagline);
  if (typeof patch.bio === 'string') add('bio', patch.bio);
  if (typeof patch.timezone === 'string') add('timezone', patch.timezone);
  if (patch.pronouns !== undefined) add('pronouns', patch.pronouns);
  if (patch.availability !== undefined) add('availability', patch.availability);
  if (patch.hue !== undefined) add('hue', patch.hue);
  if (patch.notifyMentions !== undefined) add('notify_mentions', patch.notifyMentions);
  if (patch.notifyAssignments !== undefined) add('notify_assignments', patch.notifyAssignments);
  if (patch.notifyDueSoon !== undefined) add('notify_due_soon', patch.notifyDueSoon);
  if (patch.notifyDigest !== undefined) add('notify_digest', patch.notifyDigest);
  if (params.length === 0) return;
  params.push(session.userId);
  await dbQuery(
    `UPDATE boards.user_profiles SET ${sets.join(', ')} WHERE user_id = $${params.length}`,
    params,
  );
}
