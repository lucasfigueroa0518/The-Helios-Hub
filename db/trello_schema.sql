-- db/trello_schema.sql — Helios Trello (boards) tables (idempotent).
-- Lives in Outreach Hub's Supabase Postgres under schema `boards`.
-- Do NOT point the app at a leftover donor Trello Supabase project.
--
-- Naming (merge decision):
--   Schema:  boards
--   Tables:  snake_case plurals matching the donor, minus users
--   Auth:    no boards.users — use outreach.users via Auth.js
--   Profile: boards.user_profiles holds Trello-only name/avatar/prefs
--
-- Apply:
--   npm run db:trello
--   # or full: npm run db:setup
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS boards;

-- ── Workspaces ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boards.workspaces (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    slug          text NOT NULL UNIQUE,
    owner_id      uuid NOT NULL REFERENCES outreach.users (id) ON DELETE RESTRICT,
    description   text,
    accent        text NOT NULL DEFAULT '#FF5E1A',
    visibility    text NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private', 'public')),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boards_workspaces_owner
    ON boards.workspaces (owner_id);

-- ── Workspace members ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boards.workspace_members (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES boards.workspaces (id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES outreach.users (id) ON DELETE CASCADE,
    role          text NOT NULL DEFAULT 'member'
                      CHECK (role IN ('owner', 'admin', 'member', 'guest')),
    joined_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_boards_workspace_members_user
    ON boards.workspace_members (user_id);

-- ── Boards ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boards.boards (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES boards.workspaces (id) ON DELETE CASCADE,
    created_by    uuid NOT NULL REFERENCES outreach.users (id) ON DELETE RESTRICT,
    name          text NOT NULL,
    background    text,
    canvas        text,
    theme         text NOT NULL DEFAULT 'light'
                      CHECK (theme IN ('light', 'dark')),
    visibility    text NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private', 'public')),
    archived      boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boards_boards_workspace
    ON boards.boards (workspace_id);
CREATE INDEX IF NOT EXISTS idx_boards_boards_created_by
    ON boards.boards (created_by);

-- ── Board members (per-board ACL / share) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS boards.board_members (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id      uuid NOT NULL REFERENCES boards.boards (id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES outreach.users (id) ON DELETE CASCADE,
    added_by_id   uuid NOT NULL REFERENCES outreach.users (id) ON DELETE RESTRICT,
    added_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (board_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_boards_board_members_user
    ON boards.board_members (user_id);

-- ── Lists ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boards.lists (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id      uuid NOT NULL REFERENCES boards.boards (id) ON DELETE CASCADE,
    name          text NOT NULL,
    position      real NOT NULL DEFAULT 0,
    archived      boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boards_lists_board
    ON boards.lists (board_id);

-- ── Cards ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boards.cards (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id       uuid NOT NULL REFERENCES boards.lists (id) ON DELETE CASCADE,
    board_id      uuid NOT NULL REFERENCES boards.boards (id) ON DELETE CASCADE,
    title         text NOT NULL,
    description   text,
    position      real NOT NULL DEFAULT 0,
    due_date      date,
    due_completed boolean NOT NULL DEFAULT false,
    archived      boolean NOT NULL DEFAULT false,
    created_by    uuid NOT NULL REFERENCES outreach.users (id) ON DELETE RESTRICT,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boards_cards_list
    ON boards.cards (list_id);
CREATE INDEX IF NOT EXISTS idx_boards_cards_board
    ON boards.cards (board_id);

-- ── Card members / labels / trackers ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boards.card_members (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id       uuid NOT NULL REFERENCES boards.cards (id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES outreach.users (id) ON DELETE CASCADE,
    assigned_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (card_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_boards_card_members_user
    ON boards.card_members (user_id);

CREATE TABLE IF NOT EXISTS boards.labels (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id      uuid NOT NULL REFERENCES boards.boards (id) ON DELETE CASCADE,
    name          text NOT NULL,
    color         text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_boards_labels_board
    ON boards.labels (board_id);

CREATE TABLE IF NOT EXISTS boards.card_labels (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id       uuid NOT NULL REFERENCES boards.cards (id) ON DELETE CASCADE,
    label_id      uuid NOT NULL REFERENCES boards.labels (id) ON DELETE CASCADE,
    UNIQUE (card_id, label_id)
);

CREATE TABLE IF NOT EXISTS boards.card_trackers (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id       uuid NOT NULL REFERENCES boards.cards (id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES outreach.users (id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (card_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_boards_card_trackers_user
    ON boards.card_trackers (user_id);

-- ── Checklists ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boards.checklists (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id       uuid NOT NULL REFERENCES boards.cards (id) ON DELETE CASCADE,
    title         text NOT NULL,
    position      real NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boards_checklists_card
    ON boards.checklists (card_id);

CREATE TABLE IF NOT EXISTS boards.checklist_items (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_id  uuid NOT NULL REFERENCES boards.checklists (id) ON DELETE CASCADE,
    text          text NOT NULL,
    completed     boolean NOT NULL DEFAULT false,
    position      real NOT NULL DEFAULT 0,
    due_date      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_boards_checklist_items_checklist
    ON boards.checklist_items (checklist_id);

-- ── Comments / attachments / activity ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS boards.comments (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id       uuid NOT NULL REFERENCES boards.cards (id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES outreach.users (id) ON DELETE RESTRICT,
    body          text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_boards_comments_card
    ON boards.comments (card_id);

CREATE TABLE IF NOT EXISTS boards.attachments (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id       uuid NOT NULL REFERENCES boards.cards (id) ON DELETE CASCADE,
    uploaded_by   uuid NOT NULL REFERENCES outreach.users (id) ON DELETE RESTRICT,
    file_name     text NOT NULL,
    file_url      text NOT NULL,
    file_size     integer NOT NULL,
    mime_type     text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boards_attachments_card
    ON boards.attachments (card_id);

CREATE TABLE IF NOT EXISTS boards.activity (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES outreach.users (id) ON DELETE RESTRICT,
    card_id       uuid REFERENCES boards.cards (id) ON DELETE CASCADE,
    board_id      uuid NOT NULL REFERENCES boards.boards (id) ON DELETE CASCADE,
    action_type   text NOT NULL,
    data          jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boards_activity_board
    ON boards.activity (board_id);
CREATE INDEX IF NOT EXISTS idx_boards_activity_card
    ON boards.activity (card_id);

-- ── Notification reads / favorites ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boards.notification_reads (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES outreach.users (id) ON DELETE CASCADE,
    notification_id  text NOT NULL,
    read_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, notification_id)
);

CREATE TABLE IF NOT EXISTS boards.favorite_boards (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES outreach.users (id) ON DELETE CASCADE,
    board_id      uuid NOT NULL REFERENCES boards.boards (id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, board_id)
);

-- ── Trello-only profile (lean outreach.users stays shared) ──────────────────

CREATE TABLE IF NOT EXISTS boards.user_profiles (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL UNIQUE REFERENCES outreach.users (id) ON DELETE CASCADE,
    first_name          text NOT NULL DEFAULT '',
    last_name           text NOT NULL DEFAULT '',
    avatar_url          text,
    role                text,
    tagline             text NOT NULL DEFAULT '',
    bio                 text NOT NULL DEFAULT '',
    timezone            text NOT NULL DEFAULT 'America/New_York',
    pronouns            text,
    availability        text NOT NULL DEFAULT 'available'
                            CHECK (availability IN ('available', 'away')),
    hue                 integer,
    notify_mentions     boolean NOT NULL DEFAULT true,
    notify_assignments  boolean NOT NULL DEFAULT true,
    notify_due_soon     boolean NOT NULL DEFAULT true,
    notify_digest       boolean NOT NULL DEFAULT false,
    joined_at           timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
