import { labData, realCaseRoute } from '@/lib/real-case/lab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything the Real Case lab shows (RC-10). Reads only; spends nothing. */
export async function GET() {
  return realCaseRoute(({ db }) => labData(db));
}
