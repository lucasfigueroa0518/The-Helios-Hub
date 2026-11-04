export type MenuSide = 'left' | 'right';

/**
 * Which edge of the trigger the menu should hang from. `left` grows the list
 * to the right of the button; `right` pins the list's right edge to the button
 * so it opens back into the row. A button on the drawer's right edge has no
 * room that way, and the panel clips whatever crosses it.
 */
export function menuSide(
  trigger: { left: number; right: number },
  menuWidth: number,
  bounds: { left: number; right: number },
  pad = 8,
): MenuSide {
  const roomRight = bounds.right - trigger.left - pad;
  const roomLeft = trigger.right - bounds.left - pad;
  return roomRight >= menuWidth || roomRight >= roomLeft ? 'left' : 'right';
}

export type MenuFlip = 'down' | 'up';

/**
 * Whether the menu hangs below the trigger or flips above it. A scroller
 * (overflow-x: auto turns overflow-y into a clip too) ends just under the
 * button on a post card, so a list opening downward is cut off.
 */
export function menuFlip(
  trigger: { top: number; bottom: number },
  menuHeight: number,
  bounds: { top: number; bottom: number },
  pad = 8,
): MenuFlip {
  const roomBelow = bounds.bottom - trigger.bottom - pad;
  const roomAbove = trigger.top - bounds.top - pad;
  return roomBelow >= menuHeight || roomBelow >= roomAbove ? 'down' : 'up';
}
