import { calibrateRoute } from '@/lib/reel-ai-drama/production/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Calibrate click (MD-52): queues the Jev calibration for the worker (202, about $0.10–0.30). No model runs in this request. */
export async function POST(request: Request) {
  return calibrateRoute(request);
}
