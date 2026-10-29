import { calibrateRoute } from '@/lib/reel-ai-drama/production/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Lucas's Calibrate click (MD-52): Jev scores on the calibration set (about $0.10–0.30). The click is the approval. */
export async function POST(request: Request) {
  return calibrateRoute(request);
}
