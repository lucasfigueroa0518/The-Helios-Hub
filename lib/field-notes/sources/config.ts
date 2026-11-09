/**
 * Field Notes sources and scoring config.
 *
 * `questionsApproved` is true: Tommy approved the wording of `field-notes-score@2`
 * (`questions.ts`, CONTRACT-v4 section 3) on Lucas's behalf on 2026-11-06, and approved the
 * `field-notes-score@3` fix (the added `about_ai` gate, so a non-AI tip scores 0) in chat on
 * 2026-11-06 ("Yes, please fix all the problems you identified"). Any further wording change
 * bumps the version and sets this back to false until it is approved again; the scorer refuses
 * to run while it is false.
 */
export type FieldNotesSourcesConfig = {
  questionsApproved: boolean;
};

export const FIELD_NOTES_SOURCES_CONFIG: FieldNotesSourcesConfig = {
  questionsApproved: true,
};
