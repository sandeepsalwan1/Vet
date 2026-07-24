export const LEGACY_BASELINE = "028_separate_central_vet_and_tri_city.sql";

export function planMigrations({
  files,
  appliedFiles,
  legacyBaselineComplete
}) {
  const applied = new Set(appliedFiles);
  const baseline =
    applied.size === 0 && legacyBaselineComplete
      ? files.filter((file) => file <= LEGACY_BASELINE)
      : [];

  for (const file of baseline) {
    applied.add(file);
  }

  return {
    baseline,
    pending: files.filter((file) => !applied.has(file))
  };
}
