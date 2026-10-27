export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installHubServerTiming } = await import('@/lib/server-timing-hook');
    const { installHttpRequestTelemetry } = await import('@/lib/observability/request-telemetry');
    installHubServerTiming();
    installHttpRequestTelemetry();
  }
}
