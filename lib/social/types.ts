/**
 * Domain types for Helios Social. Shapes mirror the DB rows in
 * `db/helios_social_schema.sql` but with camelCase field names for the UI.
 */

export type Article = {
  id: string;
  source: string;
  sourceUrl: string;
  headline: string;
  body: string;
  addedBy: string;
  addedByName: string | null;
  addedAt: string;
  draftedPostId: string | null;
};
