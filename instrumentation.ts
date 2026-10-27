export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installHubServerTiming } = await import('@/lib/server-timing-hook');
    installHubServerTiming();
  }
}
