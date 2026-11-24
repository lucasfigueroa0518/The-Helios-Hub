-- One-box seeding v2: which runner does the work, and when a worker claimed it. Additive.
ALTER TABLE social_hub.seed_requests ADD COLUMN IF NOT EXISTS runner text NOT NULL DEFAULT 'vercel';
ALTER TABLE social_hub.seed_requests ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
