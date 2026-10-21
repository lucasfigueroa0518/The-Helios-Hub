import type { SlotChange } from '@/lib/social-hub/slots/write';

/**
 * Undo for the week board: each edit is a command (its changes and the
 * changes that reverse it), not a snapshot of the screen. Undo is scoped to
 * the tab where the edit happened. Pure: no React.
 */

/** Where an edit happened: 'standard', or 'week:<monday>' so undo only reaches the week on screen. */
export type Tab = string;

export type Command = {
  label: string;
  changes: SlotChange[];
  inverse: SlotChange[];
  tab: Tab;
  /** False for an edit that unscheduled a booking: sending the inverse wouldn't bring the booking back. */
  undoable: boolean;
};

export function createHistory() {
  const stack: Command[] = [];
  /** The newest command of a tab, or null when it has none. */
  const last = (tab: Tab): Command | null => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i]!.tab === tab) return stack[i]!;
    return null;
  };
  return {
    push(command: Command): void {
      stack.push(command);
    },
    /** Whether the tab's newest command can be undone. A non-undoable one blocks older ones until a newer command exists. */
    canUndo(tab: Tab): boolean {
      return last(tab)?.undoable === true;
    },
    /** Takes the tab's newest command off the stack and returns it (send its `inverse`); null when it can't be undone. */
    undo(tab: Tab): Command | null {
      const c = last(tab);
      if (!c || !c.undoable) return null;
      stack.splice(stack.lastIndexOf(c), 1);
      return c;
    },
    /** The newest command of the tab, for the "Undo" label. */
    peek(tab: Tab): Command | null {
      return last(tab);
    },
  };
}

export type History = ReturnType<typeof createHistory>;
