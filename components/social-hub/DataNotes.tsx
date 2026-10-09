import { verticalInfo } from '@/lib/social-hub/verticals';
import type { HubDataset } from '@/lib/social-hub/dataset';

/** Per-vertical read failures and cost notes: the rest of the hub keeps working (§S6 degrade). */
export function DataNotes({ dataset, cost = false }: { dataset: HubDataset; cost?: boolean }) {
  const notes = [
    ...dataset.errors.map((e) => `${verticalInfo(e.vertical).label} could not be read: ${e.message}`),
    ...(cost ? dataset.costNotes : []),
  ];
  if (notes.length === 0) return null;
  return (
    <ul className="sh-note sh-datanotes" aria-label="Data notes">
      {notes.map((note, i) => <li key={`${i}-${note}`}>{note}</li>)}
    </ul>
  );
}
