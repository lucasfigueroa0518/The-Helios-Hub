/**
 * Social Hub feature flags (BUILD_PLAN §S5). Constants only: no env, no DB.
 * Every action flag is on except refreshOnVisit (Tommy, 2026-10-08: approve, regenerate, publish, reject and move work
 * from every content type's page). Nothing posts while a type's Live switch is off.
 * (Originally every action flag was off.) Phase 2 wired them all to pipeline-owned
 * functions (P2-M1: refreshOnVisit; P2-M3: the four action buttons); a
 * person turns each on, one at a time, after checking it on real data.
 */

export type ActionFlag = 'approveCarousel' | 'approveTrialReel' | 'approveContent' | 'hardPublish' | 'hardRegenerate' | 'reject' | 'reschedule' | 'refreshOnVisit';

export type ViewFlag = 'calendar' | 'analytics' | 'house' | 'post';

export type HubFlags = {
  actions: Readonly<Record<ActionFlag, boolean>>;
  views: Readonly<Record<ViewFlag, boolean>>;
};

export const SOCIAL_HUB_FLAGS: HubFlags = Object.freeze({
  actions: Object.freeze({
    // Wired in Phase 2 (P2-M1, P2-M3), left off: turning one on is Tommy's call, one at a time.
    approveCarousel: true,
    approveTrialReel: true,
    // Approve an Explainer or a Story set from its type page (the user-action layer's `approve`).
    approveContent: true,
    hardPublish: true,
    hardRegenerate: true,
    // Reject for every type (D47), through the user-action layer. Off until Tommy turns it on.
    reject: true,
    // Schedule here and move (D50): place and reschedule through the user-action layer. Off until Tommy turns it on.
    reschedule: true,
    // Needs the social_hub schema applied and the worker redeployed first.
    refreshOnVisit: false,
  }),
  views: Object.freeze({
    calendar: true,
    analytics: true,
    house: true,
    post: true,
  }),
});

export const ACTION_FLAGS: readonly ActionFlag[] = [
  'approveCarousel',
  'approveTrialReel',
  'approveContent',
  'hardPublish',
  'hardRegenerate',
  'reject',
  'reschedule',
  'refreshOnVisit',
];

export function actionEnabled(flag: ActionFlag, flags: HubFlags = SOCIAL_HUB_FLAGS): boolean {
  return flags.actions[flag] === true;
}

/** True when no action flag is on: the hub can only read. */
export function hubIsReadOnly(flags: HubFlags = SOCIAL_HUB_FLAGS): boolean {
  return ACTION_FLAGS.every((flag) => !actionEnabled(flag, flags));
}
