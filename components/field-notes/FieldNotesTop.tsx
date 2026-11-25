import { dbQuery } from '@/lib/db';

import { FieldNotesTopView } from './FieldNotesTopView';
import { loadPanelData, type PanelData } from './load';

import './field-notes.css';

/** Server component for the shell's `top` slot: reads the pool and the posts waiting for review, then shows them. */
export async function FieldNotesTop() {
  let data: PanelData | null = null;
  let error: string | null = null;
  try {
    data = await loadPanelData((text, params) => dbQuery(text, params as never) as never);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return <FieldNotesTopView data={data} error={error} />;
}
