'use server';

import { upsertUserByEmail } from '@/lib/auth';
import { dbQuery } from '@/lib/db';
import { isAllowedLoginEmail } from '@/lib/login-policy';
import { assertBoardAccess } from '@/lib/trello/access';
import { ensureTrelloProfile } from '@/lib/trello/ensure-profile';
import { requireTrelloSession } from '@/lib/trello/session';

export type ShareBoardArgs = {
  boardId: string;
  email: string;
  firstName: string;
  lastName: string;
};

export type ShareBoardResult = {
  userId: string;
  firstName: string;
  lastName: string;
  createdNewUser: boolean;
};

export async function shareBoard(args: ShareBoardArgs): Promise<ShareBoardResult> {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, args.boardId);

  const email = args.email.trim().toLowerCase();
  const firstName = args.firstName.trim();
  const lastName = args.lastName.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid email.');
  }
  if (!firstName) throw new Error('Please enter a first name.');
  if (!isAllowedLoginEmail(email)) {
    throw new Error("That email isn't allowed to join Helios.");
  }

  const existing = await dbQuery<{ id: string }>(
    'SELECT id FROM outreach.users WHERE email = $1 LIMIT 1',
    [email],
  );
  const createdNewUser = !existing.rows[0];
  const recipient = await upsertUserByEmail(email);
  await ensureTrelloProfile(recipient.id, email);

  const profile = await dbQuery<{ first_name: string; last_name: string }>(
    'SELECT first_name, last_name FROM boards.user_profiles WHERE user_id = $1',
    [recipient.id],
  );
  if (createdNewUser || !profile.rows[0]?.first_name) {
    await dbQuery(
      `UPDATE boards.user_profiles
          SET first_name = $2, last_name = $3, updated_at = now()
        WHERE user_id = $1`,
      [recipient.id, firstName, lastName],
    );
  }

  await dbQuery(
    `INSERT INTO boards.board_members (board_id, user_id, added_by_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (board_id, user_id) DO NOTHING`,
    [args.boardId, recipient.id, session.userId],
  );

  const names = createdNewUser
    ? { firstName, lastName }
    : {
        firstName: profile.rows[0]?.first_name || firstName,
        lastName: profile.rows[0]?.last_name || lastName,
      };

  return {
    userId: recipient.id,
    firstName: names.firstName,
    lastName: names.lastName,
    createdNewUser,
  };
}
