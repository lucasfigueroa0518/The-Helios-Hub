/**
 * Which pipeline version handles this article? Existing rows carry their
 * stamp — legacy rows stay on legacy. New rows (row === null) get the
 * creator pipeline when HELIOS_SOCIAL_CREATOR_PIPELINE=1.
 */
export function useCreatorPipeline(
  row: { pipeline_version: string } | null,
): boolean {
  if (row) return row.pipeline_version === 'creator';
  return process.env.HELIOS_SOCIAL_CREATOR_PIPELINE === '1';
}
