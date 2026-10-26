import { REEL_IDEAS_SQL } from '@/lib/social-hub/queries/reels';
import { writeFileSync } from 'node:fs';
writeFileSync('.tmp/q.sql', `BEGIN READ ONLY;\nSELECT rank, selected, on_latest, made_on_latest, copy_missed, round(net::numeric,2) FROM (${REEL_IDEAS_SQL.replace(/LIMIT 200\s*$/, 'LIMIT 200')}) z WHERE selected OR rank <= 5 OR copy_missed ORDER BY rank NULLS LAST;\nROLLBACK;\n`);
