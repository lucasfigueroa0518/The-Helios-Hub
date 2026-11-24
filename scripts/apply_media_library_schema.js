// Apply db/media_library_schema.sql, the photo bank (modeled on
// scripts/apply_social_hub_schema.js). Written with the photo bank (D49), NOT
// run there: applying is a human decision, so the script refuses to run
// without --apply. No npm script (package.json stays unchanged):
//   node scripts/apply_media_library_schema.js --apply
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (!process.argv.includes('--apply')) {
  console.error('Refusing to run without --apply (this changes the shared database).');
  process.exit(2);
}

const root = path.join(__dirname, '..');
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
// The base schema, then the Stories split (licence `generated`, truth/gen_model/gen_prompt, run kinds ai_trivia and
// real_or_ai). Both re-apply cleanly.
for (const file of ['media_library_schema.sql', 'media_library_stories_split.sql']) {
  const schema = path.join(root, 'db', file);
  const result = spawnSync(psql, ['-d', url, '-v', 'ON_ERROR_STOP=1', '-f', schema], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PGSSLMODE: process.platform === 'win32' ? 'disable' : (process.env.PGSSLMODE || 'require'),
    },
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('media_library schema applied (capture and finder_source are OFF until flipped)');
