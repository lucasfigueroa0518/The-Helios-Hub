// Applies db/helios_social_image_cache_migration.sql AND provisions the
// Supabase Storage bucket helios-social-images (public read, service-role
// write). Both steps are idempotent so re-running is safe.
//
// Requires .env.local to define:
//   DIRECT_DATABASE_URL         — postgres URL for psql
//   NEXT_PUBLIC_SUPABASE_URL    — https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — service-role key for the Storage REST API

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) process.env[match[1]] = match[2];
  }
}

const dbUrl = process.env.DIRECT_DATABASE_URL;
if (!dbUrl) {
  console.error('DIRECT_DATABASE_URL is not set (check .env.local)');
  process.exit(1);
}
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing (check .env.local)');
  process.exit(1);
}

// ── 1. SQL migration via psql (same pattern as the other apply_* scripts).
const windowsPsql = 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe';
const psql = process.env.PSQL_BIN
  || (process.platform === 'win32' && fs.existsSync(windowsPsql) ? windowsPsql : 'psql');
const schema = path.join(root, 'db', 'helios_social_image_cache_migration.sql');
const psqlResult = spawnSync(psql, ['-d', dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', schema], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PGSSLMODE: process.platform === 'win32' ? 'disable' : (process.env.PGSSLMODE || 'require'),
  },
  shell: false,
});
if (psqlResult.status !== 0) process.exit(psqlResult.status ?? 1);

// ── 2. Storage bucket via Supabase's Storage REST API.
(async () => {
  const bucket = 'helios-social-images';
  const headers = {
    'apikey': serviceRoleKey,
    'authorization': `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  };
  const base = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1`;

  // Check existence first.
  const checkRes = await fetch(`${base}/bucket/${bucket}`, { headers });
  if (checkRes.ok) {
    console.log(`Storage bucket "${bucket}" already exists (skipping create).`);
    return;
  }
  if (checkRes.status !== 404 && checkRes.status !== 400) {
    console.error(`Bucket check failed (HTTP ${checkRes.status}): ${await checkRes.text()}`);
    process.exit(1);
  }

  const createRes = await fetch(`${base}/bucket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: true,
      file_size_limit: 10_485_760, // 10 MB per file — full-bleed 1080×1350 JPGs are well under.
      allowed_mime_types: ['image/jpeg', 'image/png'],
    }),
  });
  if (!createRes.ok) {
    console.error(`Bucket create failed (HTTP ${createRes.status}): ${await createRes.text()}`);
    process.exit(1);
  }
  console.log(`Storage bucket "${bucket}" created (public, 10 MB / file, jpg/png).`);
})().then(() => {
  console.log('helios_social image_cache migration applied');
});
