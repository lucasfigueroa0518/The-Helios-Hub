'use server';

import { dbQuery } from '@/lib/db';
import { requireTrelloSession } from '@/lib/trello/session';

export async function markNotificationRead(_userId: string, notificationId: string) {
  const session = await requireTrelloSession();
  await dbQuery(
    `INSERT INTO boards.notification_reads (user_id, notification_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, notification_id) DO NOTHING`,
    [session.userId, notificationId],
  );
}

export async function markNotificationsRead(_userId: string, notificationIds: string[]) {
  const session = await requireTrelloSession();
  if (!notificationIds.length) return;
  for (const notificationId of notificationIds) {
    await dbQuery(
      `INSERT INTO boards.notification_reads (user_id, notification_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, notification_id) DO NOTHING`,
      [session.userId, notificationId],
    );
  }
}
