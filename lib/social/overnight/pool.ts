import type { ThreeAm } from '@/lib/lfd/clock';

/**
 * The nightly pool refresh (`auto_pool`): the carousel run's scoring without its making, so the idea
 * pool fills whether or not content is generated. The 3:00 AM clock queues it when the carousel run
 * is not queued (Generate off, or a calendar rule says none that day). A real carousel run already
 * scores, and a Last Few Days run is the night's one Claude pipeline, so neither gets a pool run.
 */
export function poolRunDue(queue: ThreeAm['queue'], autoPool: boolean): boolean {
  return autoPool && queue !== 'carousels' && queue !== 'last_few_days';
}
