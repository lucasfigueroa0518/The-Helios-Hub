import { SlotEditor } from '@/components/social-hub/calendar/SlotEditor';
import { WEEKDAY_SHORT } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import { minuteLabel } from '@/lib/social-hub/views/plan';
import { chipNames, type WeekModel } from '@/lib/social-hub/views/week';

/** The window grid (spec §3): rows are time windows, columns are days; click a chip or + to edit. */
export function WeekGrid({ model, scope, dim, readOnly, templateCarousels }: { model: WeekModel; scope: 'date' | 'template'; dim: Vertical | null; readOnly: boolean; /** The template's Carousel windows by weekday. */ templateCarousels: Record<number, string[]> }) {
  // Each date's resolved Carousel windows, for a Carousel chip's "Make this a Last Few Days day".
  const carousels = model.columns.map((_, i) => model.rows.flatMap(({ cells }) => cells[i]!.chips.filter((c) => c.vertical === 'carousels').map((c) => c.windowId)));
  return (
    <div className="sh-week">
      <div className="sh-week__table" role="table" aria-label={scope === 'template' ? 'Weekly template' : 'Week of slots'}>
        <div className="sh-week__row sh-week__head" role="row">
          <span role="columnheader" className="sh-week__corner"><span className="sh-sr">Window</span></span>
          {model.columns.map((c) => (
            <span key={`${c.weekday}-${c.nyDate}`} role="columnheader" className={`sh-week__col${c.isToday ? ' is-today' : ''}${c.past ? ' is-past' : ''}`} aria-current={c.isToday ? 'date' : undefined}>
              {WEEKDAY_SHORT[c.weekday]}{c.nyDate ? <span className="sh-week__num">{Number(c.nyDate.slice(8, 10))}</span> : null}
            </span>
          ))}
        </div>
        {model.rows.map(({ row, cells }) => (
          <div key={row.id} className="sh-week__row" role="row">
            <span role="rowheader" className="sh-week__time">
              <span className="sh-week__at">{minuteLabel(row.startMinute)}</span>
              <span className="sh-week__what">{row.label}</span>
            </span>
            {cells.map((cell, i) => (
              <div key={`${row.id}-${cell.weekday}-${cell.nyDate}`} role="cell" className={`sh-week__cell${model.columns[i]!.past ? ' is-past' : ''}${model.columns[i]!.isToday ? ' is-today' : ''}`}>
                {cell.chips.map((chip) => (
                  <SlotEditor
                    key={`${chip.vertical}-${chip.windowId}`}
                    cell={cell}
                    chip={chip}
                    scope={scope}
                    readOnly={readOnly || !chip.editable}
                    label={`${chipNames(chip.vertical, chip.windowId).short}${chip.feedMode ? ` · ${chip.feedMode === 'trial' ? 'Trial' : 'Main'}` : ''}`}
                    dimmed={dim !== null && dim !== chip.vertical}
                    dayCarousels={carousels[i]}
                    weekdayCarousels={templateCarousels[cell.weekday] ?? []}
                    lfdOpen={model.columns[i]!.lfdOpen}
                  />
                ))}
                {cell.chips.length === 0 && cell.blockedReason ? <span className="sh-week__blocked">{cell.blockedReason}</span> : null}
                {cell.addable.length && !readOnly ? <SlotEditor cell={cell} chip={null} scope={scope} label="+" /> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
