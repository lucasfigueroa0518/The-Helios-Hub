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
