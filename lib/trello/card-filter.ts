export type CardUserAssociation = {
  assigneeIds: string[];
  createdById: string;
};

/** True when this card belongs to the user as assignee or creator. */
export function cardAssociatedWithUser(
  card: CardUserAssociation,
  userId: string,
): boolean {
  return card.createdById === userId || card.assigneeIds.includes(userId);
}

/**
 * Board filter: an empty selection shows every card. Selecting people
 * keeps cards they created or are assigned to.
 */
export function cardMatchesUserFilter(
  card: CardUserAssociation,
  filterUserIds: string[],
): boolean {
  if (filterUserIds.length === 0) return true;
  return filterUserIds.some((id) => cardAssociatedWithUser(card, id));
}
