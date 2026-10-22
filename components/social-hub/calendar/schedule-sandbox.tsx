'use client';

import { createContext, useContext, useMemo, useState, type ComponentProps, type ReactNode } from 'react';

import { WeekBoard } from '@/components/social-hub/calendar/WeekBoard';
import type { TemplateRow } from '@/lib/social-hub/slots/types';
import { datedWeek, standardByWeekday, templateWeek } from '@/lib/social-hub/views/week';

/**
 * The preview's standing week, held on screen (nothing is saved). A
 * Schedules save there replaces the template; the board recomputes its week
 * from it, the same way the preview page built it from the seed.
 */

type Sandbox = { template: TemplateRow[]; setTemplate: (t: TemplateRow[]) => void };

const SandboxContext = createContext<Sandbox | null>(null);

export function ScheduleSandbox({ template, children }: { template: TemplateRow[]; children: ReactNode }) {
  const [rows, setRows] = useState(template);
  const value = useMemo(() => ({ template: rows, setTemplate: setRows }), [rows]);
  return <SandboxContext.Provider value={value}>{children}</SandboxContext.Provider>;
}

/** The preview's template and its setter; null on the live page. */
export function useScheduleSandbox(): Sandbox | null {
  return useContext(SandboxContext);
}

/** The week board on the preview: its days and standard week follow the sandbox template. */
export function SandboxWeekBoard(props: ComponentProps<typeof WeekBoard>) {
  const sandbox = useScheduleSandbox();
  const template = sandbox?.template ?? null;
  const { mode, monday } = props;
  const view = useMemo(() => {
    if (!template) return null;
    return { days: mode === 'template' ? templateWeek(template, monday) : datedWeek(template, monday), standard: standardByWeekday(template) };
  }, [template, mode, monday]);
  return <WeekBoard {...props} days={view?.days ?? props.days} standard={view?.standard ?? props.standard} />;
}
