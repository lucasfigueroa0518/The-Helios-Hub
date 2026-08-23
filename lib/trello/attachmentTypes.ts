/**
 * Shared attachment constants. Kept out of `app/actions/attachments.ts`
 * because that file is `"use server"` — those can only export async
 * functions, not runtime values.
 */

/** Sentinel mimeType for link-shaped attachments (pasted URL, not an uploaded file). */
export const LINK_MIME = "link";
