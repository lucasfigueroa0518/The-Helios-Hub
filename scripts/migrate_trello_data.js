/**
 * One-time copy: donor Trello app (public.*) → The Helios Hub boards.* schema.
 *
 * Env:
 *   DIRECT_DATABASE_URL           — The Helios Hub target (required)
 *   TRELLO_DONOR_DATABASE_URL     — donor Postgres URL
 *
 * Never logs connection strings, passwords, or tokens.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const root = path.join(__dirname, '..');
const donorEnvPath = path.join(root, '.trello-donor.env');

function loadEnvFile(filePath, into = process.env) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && into[match[1]] === undefined) into[match[1]] = match[2];
  }
}

loadEnvFile(path.join(root, '.env.local'));
const donorEnv = {};
loadEnvFile(donorEnvPath, donorEnv);

const targetUrl = process.env.DIRECT_DATABASE_URL;
const donorUrl =
  process.env.TRELLO_DONOR_DATABASE_URL
  || donorEnv.TRELLO_DONOR_DATABASE_URL
  || donorEnv.DATABASE_URL;

if (!targetUrl) {
  console.error('DIRECT_DATABASE_URL is not set (Outreach Hub DB).');
  process.exit(1);
}
if (!donorUrl) {
  console.error(
    'Donor DB URL missing. Set TRELLO_DONOR_DATABASE_URL.',
  );
  process.exit(1);
}
if (donorUrl === targetUrl) {
  console.error('Donor and target URLs resolve to the same database. Aborting.');
  process.exit(1);
}

function sslFor(url) {
  if (/localhost|127\.0\.0\.1/.test(url)) return undefined;
  return { rejectUnauthorized: false };
}

function displayNameFromEmail(email) {
  const local = String(email).split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ') || 'User';
}

async function count(client, sql) {
  const { rows } = await client.query(sql);
  return Number(rows[0].n);
}

async function main() {
  const donor = new Client({ connectionString: donorUrl, ssl: sslFor(donorUrl) });
  const target = new Client({ connectionString: targetUrl, ssl: sslFor(targetUrl) });
  await donor.connect();
  await target.connect();

  try {
    const donorCounts = {
      users: await count(donor, 'SELECT count(*)::int AS n FROM users'),
      workspaces: await count(donor, 'SELECT count(*)::int AS n FROM workspaces'),
      boards: await count(donor, 'SELECT count(*)::int AS n FROM boards'),
      cards: await count(donor, 'SELECT count(*)::int AS n FROM cards'),
      activity: await count(donor, 'SELECT count(*)::int AS n FROM activity'),
    };
    console.log('Donor row counts:', donorCounts);

    const { rows: donorUsers } = await donor.query(`
      SELECT id, email, first_name, last_name, avatar_url, role
      FROM users
    `);

    const userMap = new Map();
    for (const u of donorUsers) {
      const email = String(u.email || '').trim().toLowerCase();
      if (!email) {
        console.error('Donor user missing email; aborting.');
        process.exit(1);
      }
      const existing = await target.query(
        'SELECT id FROM outreach.users WHERE email = $1',
        [email],
      );
      let outreachId = existing.rows[0]?.id;
      if (!outreachId) {
        const display = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
          || displayNameFromEmail(email);
        const inserted = await target.query(
          `INSERT INTO outreach.users (email, display_name, last_login_at)
           VALUES ($1, $2, NULL)
           RETURNING id`,
          [email, display],
        );
        outreachId = inserted.rows[0].id;
      }
      userMap.set(u.id, outreachId);
    }
    console.log(`Mapped ${userMap.size} donor users onto outreach.users`);

    const remap = (id) => {
      if (id == null) return null;
      const next = userMap.get(id);
      if (!next) throw new Error('Unmapped donor user id');
      return next;
    };

    await target.query('BEGIN');

    await target.query('DELETE FROM boards.activity');
    await target.query('DELETE FROM boards.comments');
    await target.query('DELETE FROM boards.attachments');
    await target.query('DELETE FROM boards.checklist_items');
    await target.query('DELETE FROM boards.checklists');
    await target.query('DELETE FROM boards.card_labels');
    await target.query('DELETE FROM boards.card_members');
    await target.query('DELETE FROM boards.card_trackers');
    await target.query('DELETE FROM boards.cards');
    await target.query('DELETE FROM boards.labels');
    await target.query('DELETE FROM boards.lists');
    await target.query('DELETE FROM boards.favorite_boards');
    await target.query('DELETE FROM boards.notification_reads');
    await target.query('DELETE FROM boards.board_members');
    await target.query('DELETE FROM boards.boards');
    await target.query('DELETE FROM boards.workspace_members');
    await target.query('DELETE FROM boards.workspaces');
    await target.query('DELETE FROM boards.user_profiles');

    const copy = async (sql, rows, paramsFn) => {
      for (const row of rows) {
        await target.query(sql, paramsFn(row));
      }
    };

    const { rows: workspaces } = await donor.query(
      `SELECT id, name, slug, owner_id, description, accent, visibility::text AS visibility, created_at FROM workspaces`,
    );
    await copy(
      `INSERT INTO boards.workspaces (id, name, slug, owner_id, description, accent, visibility, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      workspaces,
      (r) => [r.id, r.name, r.slug, remap(r.owner_id), r.description, r.accent || '#FF5E1A', r.visibility || 'private', r.created_at],
    );

    const { rows: workspaceMembers } = await donor.query(
      `SELECT id, workspace_id, user_id, role::text AS role, joined_at FROM workspace_members`,
    );
    await copy(
      `INSERT INTO boards.workspace_members (id, workspace_id, user_id, role, joined_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      workspaceMembers,
      (r) => [r.id, r.workspace_id, remap(r.user_id), r.role || 'member', r.joined_at],
    );

    const { rows: boards } = await donor.query(
      `SELECT id, workspace_id, created_by, name, background, canvas, theme::text AS theme,
              visibility::text AS visibility, archived, created_at, updated_at
       FROM boards`,
    );
    await copy(
      `INSERT INTO boards.boards
         (id, workspace_id, created_by, name, background, canvas, theme, visibility, archived, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      boards,
      (r) => [
        r.id, r.workspace_id, remap(r.created_by), r.name, r.background, r.canvas,
        r.theme || 'light', r.visibility || 'private', r.archived, r.created_at, r.updated_at,
      ],
    );

    const { rows: boardMembers } = await donor.query(
      `SELECT id, board_id, user_id, added_by_id, added_at FROM board_members`,
    );
    await copy(
      `INSERT INTO boards.board_members (id, board_id, user_id, added_by_id, added_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (board_id, user_id) DO NOTHING`,
      boardMembers,
      (r) => [r.id, r.board_id, remap(r.user_id), remap(r.added_by_id), r.added_at],
    );

    const { rows: lists } = await donor.query(
      `SELECT id, board_id, name, position, archived, created_at FROM lists`,
    );
    await copy(
      `INSERT INTO boards.lists (id, board_id, name, position, archived, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      lists,
      (r) => [r.id, r.board_id, r.name, r.position, r.archived, r.created_at],
    );

    const { rows: cards } = await donor.query(
      `SELECT id, list_id, board_id, title, description, position, due_date, due_completed,
              archived, created_by, created_at, updated_at
       FROM cards`,
    );
    await copy(
      `INSERT INTO boards.cards
         (id, list_id, board_id, title, description, position, due_date, due_completed,
          archived, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      cards,
      (r) => [
        r.id, r.list_id, r.board_id, r.title, r.description, r.position, r.due_date,
        r.due_completed, r.archived, remap(r.created_by), r.created_at, r.updated_at,
      ],
    );

    const { rows: labels } = await donor.query(
      `SELECT id, board_id, name, color FROM labels`,
    );
    await copy(
      `INSERT INTO boards.labels (id, board_id, name, color) VALUES ($1,$2,$3,$4)`,
      labels,
      (r) => [r.id, r.board_id, r.name, r.color],
    );

    const { rows: cardMembers } = await donor.query(
      `SELECT id, card_id, user_id, assigned_at FROM card_members`,
    );
    await copy(
      `INSERT INTO boards.card_members (id, card_id, user_id, assigned_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (card_id, user_id) DO NOTHING`,
      cardMembers,
      (r) => [r.id, r.card_id, remap(r.user_id), r.assigned_at],
    );

    const { rows: cardLabels } = await donor.query(
      `SELECT id, card_id, label_id FROM card_labels`,
    );
    await copy(
      `INSERT INTO boards.card_labels (id, card_id, label_id) VALUES ($1,$2,$3)
       ON CONFLICT (card_id, label_id) DO NOTHING`,
      cardLabels,
      (r) => [r.id, r.card_id, r.label_id],
    );

    const { rows: cardTrackers } = await donor.query(
      `SELECT id, card_id, user_id, created_at FROM card_trackers`,
    );
    await copy(
      `INSERT INTO boards.card_trackers (id, card_id, user_id, created_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (card_id, user_id) DO NOTHING`,
      cardTrackers,
      (r) => [r.id, r.card_id, remap(r.user_id), r.created_at],
    );

    const { rows: checklists } = await donor.query(
      `SELECT id, card_id, title, position, created_at FROM checklists`,
    );
    await copy(
      `INSERT INTO boards.checklists (id, card_id, title, position, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      checklists,
      (r) => [r.id, r.card_id, r.title, r.position, r.created_at],
    );

    const { rows: checklistItems } = await donor.query(
      `SELECT id, checklist_id, text, completed, position, due_date FROM checklist_items`,
    );
    await copy(
      `INSERT INTO boards.checklist_items (id, checklist_id, text, completed, position, due_date)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      checklistItems,
      (r) => [r.id, r.checklist_id, r.text, r.completed, r.position, r.due_date],
    );

    const { rows: comments } = await donor.query(
      `SELECT id, card_id, user_id, body, created_at, updated_at, deleted_at FROM comments`,
    );
    await copy(
      `INSERT INTO boards.comments (id, card_id, user_id, body, created_at, updated_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      comments,
      (r) => [r.id, r.card_id, remap(r.user_id), r.body, r.created_at, r.updated_at, r.deleted_at],
    );

    const { rows: attachments } = await donor.query(
      `SELECT id, card_id, uploaded_by, file_name, file_url, file_size, mime_type, created_at FROM attachments`,
    );
    await copy(
      `INSERT INTO boards.attachments
         (id, card_id, uploaded_by, file_name, file_url, file_size, mime_type, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      attachments,
      (r) => [r.id, r.card_id, remap(r.uploaded_by), r.file_name, r.file_url, r.file_size, r.mime_type, r.created_at],
    );

    const { rows: activity } = await donor.query(
      `SELECT id, user_id, card_id, board_id, action_type, data, created_at FROM activity`,
    );
    await copy(
      `INSERT INTO boards.activity (id, user_id, card_id, board_id, action_type, data, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      activity,
      (r) => [r.id, remap(r.user_id), r.card_id, r.board_id, r.action_type, r.data, r.created_at],
    );

    const { rows: favorites } = await donor.query(
      `SELECT id, user_id, board_id, created_at FROM favorite_boards`,
    );
    await copy(
      `INSERT INTO boards.favorite_boards (id, user_id, board_id, created_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, board_id) DO NOTHING`,
      favorites,
      (r) => [r.id, remap(r.user_id), r.board_id, r.created_at],
    );

    const { rows: reads } = await donor.query(
      `SELECT id, user_id, notification_id, read_at FROM notification_reads`,
    );
    await copy(
      `INSERT INTO boards.notification_reads (id, user_id, notification_id, read_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, notification_id) DO NOTHING`,
      reads,
      (r) => [r.id, remap(r.user_id), r.notification_id, r.read_at],
    );

    const { rows: profiles } = await donor.query(
      `SELECT user_id, tagline, bio, timezone, pronouns, availability::text AS availability,
              hue, notify_mentions, notify_assignments, notify_due_soon, notify_digest,
              joined_at, updated_at
       FROM user_profiles`,
    );
    const profileByDonorUser = new Map(profiles.map((p) => [p.user_id, p]));
    for (const u of donorUsers) {
      const p = profileByDonorUser.get(u.id);
      await target.query(
        `INSERT INTO boards.user_profiles (
           user_id, first_name, last_name, avatar_url, role, tagline, bio, timezone, pronouns,
           availability, hue, notify_mentions, notify_assignments, notify_due_soon, notify_digest,
           joined_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (user_id) DO UPDATE SET
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           avatar_url = EXCLUDED.avatar_url,
           role = EXCLUDED.role`,
        [
          remap(u.id),
          u.first_name || '',
          u.last_name || '',
          u.avatar_url,
          u.role,
          p?.tagline ?? '',
          p?.bio ?? '',
          p?.timezone ?? 'America/New_York',
          p?.pronouns ?? null,
          p?.availability ?? 'available',
          p?.hue ?? null,
          p?.notify_mentions ?? true,
          p?.notify_assignments ?? true,
          p?.notify_due_soon ?? true,
          p?.notify_digest ?? false,
          p?.joined_at ?? new Date(),
          p?.updated_at ?? new Date(),
        ],
      );
    }

    await target.query('COMMIT');

    const targetCounts = {
      workspaces: await count(target, 'SELECT count(*)::int AS n FROM boards.workspaces'),
      boards: await count(target, 'SELECT count(*)::int AS n FROM boards.boards'),
      cards: await count(target, 'SELECT count(*)::int AS n FROM boards.cards'),
      activity: await count(target, 'SELECT count(*)::int AS n FROM boards.activity'),
    };
    console.log('Target row counts:', targetCounts);

    const ok =
      targetCounts.workspaces === donorCounts.workspaces
      && targetCounts.boards === donorCounts.boards
      && targetCounts.cards === donorCounts.cards
      && targetCounts.activity === donorCounts.activity;
    if (!ok) {
      console.error('Row count mismatch after import.');
      process.exit(1);
    }
    console.log('Trello data migration complete.');
  } catch (err) {
    try { await target.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('Migration failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await donor.end().catch(() => {});
    await target.end().catch(() => {});
  }
}

main();
