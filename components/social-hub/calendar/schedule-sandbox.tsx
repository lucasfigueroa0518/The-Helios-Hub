'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';

import { WeekBoard } from '@/components/social-hub/calendar/WeekBoard';
import type { TemplateRow } from '@/lib/social-hub/slots/types';
import type { ScheduleChange } from '@/lib/social-hub/views/schedule-week';

/**
 * The preview's standing week, held on screen (nothing is saved). A
 * Schedules save there replaces the template and hands the board the change;
 * the board applies it to the week it shows (views/schedule-week.ts), the
 * way the server's save would: past days and today's started slots stay,
 * and board edits made before the save are kept.
 */

type Sandbox = {
  template: TemplateRow[];
  /** Every change so far, oldest first: the board replays them over the week it was given (also after it resets). */
  changes: ScheduleChange[];
  /** Replace the template; the board follows. */
  apply: (after: TemplateRow[], entries: ScheduleChange['entries'], clear: ScheduleChange['clear']) => void;
};

const SandboxContext = createContext<Sandbox | null>(null);

export function ScheduleSandbox({ template, children }: { template: TemplateRow[]; children: ReactNode }) {
  const [state, setState] = useState<{ template: TemplateRow[]; changes: ScheduleChange[] }>({ template, changes: [] });
  const ids = useRef(0);
  const apply = useCallback<Sandbox['apply']>((after, entries, clear) => {
    setState((s) => ({ template: after, changes: [...s.changes, { id: ++ids.current, before: s.template, after, entries, clear }] }));
  }, []);
  const value = useMemo(() => ({ ...state, apply }), [state, apply]);
  return <SandboxContext.Provider value={value}>{children}</SandboxContext.Provider>;
}

/** The preview's template and its setter; null on the live page. */
export function useScheduleSandbox(): Sandbox | null {
  return useContext(SandboxContext);
}

/** The week board on the preview: it applies each Schedules save to the week on screen. */
export function SandboxWeekBoard(props: ComponentProps<typeof WeekBoard>) {
  const sandbox = useScheduleSandbox();
  return <WeekBoard {...props} scheduleChanges={sandbox?.changes} />;
}
