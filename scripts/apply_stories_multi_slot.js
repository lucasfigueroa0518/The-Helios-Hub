// Apply db/stories_multi_slot.sql (modeled on scripts/apply_stories_schema.js).
// Drops the one-a-day Stories index so a series can post twice a day (ruling R25).
// Run it only after db/stories_schema.sql is applied and the social worker and the
// hub are deployed with the free-time-slot code; see docs/social-overnight.md (D59).
// Dry run by default: prints what it would run. Changes the database only with --apply.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'db', 'stories_multi_slot.sql');

if (!process.argv.includes('--apply')) {
  console.log('Dry run (nothing sent to the database). With --apply this runs:');
  console.log(`  psql -d $DIRECT_DATABASE_URL -v ON_ERROR_STOP=1 -f ${path.relative(root, file)}`);
  console.log('It drops stories.uq_stories_sets_live_day (series, ny_date) and keeps');
  console.log('stories.uq_stories_sets_live_slot (series, ny_date, coalesce(slot_minute, -1)).');
  console.log('Order: both schema files applied -> social worker + hub deployed -> this -> switch on.');
  process.exit(0);
}

const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) process.env[match[1]] = match[2];
  }
}

const url = process.env.DIRECT_DATABASE_URL;
if (!url) {
  console.error('DIRECT_DATABASE_URL is not set (check .env.local)');
  process.exit(1);
}

const windowsPsql = 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe';
const psql = process.env.PSQL_BIN
  || (process.platform === 'win32' && fs.existsSync(windowsPsql) ? windowsPsql : 'psql');
const result = spawnSync(psql, ['-d', url, '-v', 'ON_ERROR_STOP=1', '-f', file], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    PGSSLMODE: process.platform === 'win32' ? 'disable' : (process.env.PGSSLMODE || 'require'),
  },
  shell: false,
});
if (result.status !== 0) process.exit(result.status ?? 1);

console.log('stories multi-slot applied (one-a-day index dropped)');
