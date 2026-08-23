'use server';

import { dbQuery } from '@/lib/db';
import { LINK_MIME } from '@/lib/trello/attachmentTypes';
import { assertBoardAccess } from '@/lib/trello/access';
import { requireTrelloSession } from '@/lib/trello/session';

export type CreateLinkAttachmentArgs = {
  id: string;
  cardId: string;
  uploadedBy: string;
  url: string;
  title: string;
};

export async function createLinkAttachment(args: CreateLinkAttachmentArgs) {
  const session = await requireTrelloSession();
  const card = await dbQuery<{ board_id: string }>(
    'SELECT board_id FROM boards.cards WHERE id = $1 LIMIT 1',
    [args.cardId],
  );
  if (!card.rows[0]) throw new Error('Card not found.');
  await assertBoardAccess(session.userId, card.rows[0].board_id);
  await dbQuery(
    `INSERT INTO boards.attachments (id, card_id, uploaded_by, file_name, file_url, file_size, mime_type)
     VALUES ($1, $2, $3, $4, $5, 0, $6)`,
    [args.id, args.cardId, session.userId, args.title, args.url, LINK_MIME],
  );
}

export async function deleteAttachment(id: string) {
  const session = await requireTrelloSession();
  const row = await dbQuery<{ board_id: string }>(
    `SELECT c.board_id
       FROM boards.attachments a
       JOIN boards.cards c ON c.id = a.card_id
      WHERE a.id = $1`,
    [id],
  );
  if (!row.rows[0]) return;
  await assertBoardAccess(session.userId, row.rows[0].board_id);
  await dbQuery('DELETE FROM boards.attachments WHERE id = $1', [id]);
}
