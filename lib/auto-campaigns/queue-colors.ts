import { AUTO_QUEUE_COLORS, type AutoQueueColor } from '@/lib/auto-campaigns/types';

export function isQueueColor(value: string | null | undefined): value is AutoQueueColor {
  return Boolean(value && (AUTO_QUEUE_COLORS as readonly string[]).includes(value));
}

export function pickQueueColor(used: string[]): AutoQueueColor {
  const taken = new Set(used);
  const free = AUTO_QUEUE_COLORS.find((color) => !taken.has(color));
  if (free) return free;
  const counts = new Map<string, number>(AUTO_QUEUE_COLORS.map((color) => [color, 0]));
  for (const color of used) {
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return [...AUTO_QUEUE_COLORS].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0))[0]!;
}

/**
 * One distinct palette token per campaign on the board. Prefers the stored
 * color when it is still free; otherwise the next unused Trello/hub hue.
 */
export function uniqueCampaignColors(
  entries: Array<{ campaignId: string; queueColor?: string | null }>,
): Map<string, AutoQueueColor> {
  const assigned = new Map<string, AutoQueueColor>();
  const used: string[] = [];
  for (const entry of entries) {
    const id = entry.campaignId.trim();
    if (!id || assigned.has(id)) continue;
    const preferred = entry.queueColor?.trim();
    const color = preferred && isQueueColor(preferred) && !used.includes(preferred)
      ? preferred
      : pickQueueColor(used);
    assigned.set(id, color);
    used.push(color);
  }
  return assigned;
}
