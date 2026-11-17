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

const url = process.env.DIRECT_DATABASE_URL;
if (!url) {
  console.error('DIRECT_DATABASE_URL is not set (check .env.local)');
  process.exit(1);
}

const windowsPsql = 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe';
const psql = process.env.PSQL_BIN
  || (process.platform === 'win32' && fs.existsSync(windowsPsql) ? windowsPsql : 'psql');
// db/stories_ai_trivia.sql (AI Trivia: series, cells, video frames) runs after the base schema it alters, and
// db/stories_real_or_ai.sql (Real or AI?: series, still roles, archive, lab) after that.
// db/stories_split.sql last: the strict per-type CHECKs and any row still filed under 'stories' moved to its type.
for (const file of ['stories_schema.sql', 'stories_ai_trivia.sql', 'stories_real_or_ai.sql', 'stories_split.sql']) {
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

console.log('stories schema applied');
