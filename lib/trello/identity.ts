/** Pure helpers used by Trello identity rules and offline tests. */

export function outreachUserDeleteForbidden(sql: string): boolean {
  return /delete\s+from\s+outreach\.users\b/i.test(sql);
}

export type DonorUser = { id: string; email: string };

/** Map donor user ids onto outreach.users ids by lowercase email. */
export function remapUsersByEmail(
  donors: DonorUser[],
  outreachByEmail: Record<string, string>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const donor of donors) {
    const email = donor.email.trim().toLowerCase();
    const outreachId = outreachByEmail[email];
    if (!outreachId) throw new Error(`No outreach.users row for ${email}`);
    map.set(donor.id, outreachId);
  }
  return map;
}
