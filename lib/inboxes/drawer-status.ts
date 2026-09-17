import type { LifecycleStage } from '@/lib/delivery-states';

export type StageAction = { stage: string; label: string; tone: string };

/** One current-state line next to the stage pill. Null means the pill is enough. */
export function inboxStatusHeadline(input: {
  lifecycleStage: string;
  linked: boolean;
  warmupEnabled: boolean | null;
}): string | null {
  if (input.lifecycleStage === 'retired') return null;
  if (!input.linked) return 'Not in Smartlead';
  if (input.warmupEnabled) return 'Warmup is active';
  if (input.lifecycleStage === 'warming' || input.lifecycleStage === 'provisioning') {
    return 'Warmup is off';
  }
  return null;
}

/** Manual moves offered per stage. Hide Start warmup when Smartlead warmup is already on. */
export function stageActionsFor(
  stage: string,
  warmupEnabled: boolean | null = null,
): StageAction[] {
  switch (stage as LifecycleStage | string) {
    case 'provisioning':
      return [
        { stage: 'warming', label: 'Start warmup', tone: 'warming' },
        { stage: 'retired', label: 'Retire', tone: 'retired' },
      ];
    case 'warming':
      return [
        ...(warmupEnabled
          ? []
          : [{ stage: 'warming', label: 'Start warmup', tone: 'warming' }]),
        { stage: 'ramping', label: 'Promote to ramping', tone: 'ramping' },
        { stage: 'resting', label: 'Set to rest', tone: 'resting' },
        { stage: 'retired', label: 'Retire', tone: 'retired' },
      ];
    case 'ramping':
      return [
        { stage: 'production', label: 'Promote to production', tone: 'production' },
        { stage: 'resting', label: 'Set to rest', tone: 'resting' },
        { stage: 'retired', label: 'Retire', tone: 'retired' },
      ];
    case 'production':
      return [
        { stage: 'resting', label: 'Set to rest', tone: 'resting' },
        { stage: 'retired', label: 'Retire', tone: 'retired' },
      ];
    case 'resting':
      return [
        { stage: 'ramping', label: 'Resume sending', tone: 'ramping' },
        { stage: 'restart_warmup', label: 'Restart warmup', tone: 'warming' },
        { stage: 'retired', label: 'Retire', tone: 'retired' },
      ];
    case 'retired':
      return [{ stage: 'provisioning', label: 'Re-enable', tone: 'provisioning' }];
    default:
      return [];
  }
}
