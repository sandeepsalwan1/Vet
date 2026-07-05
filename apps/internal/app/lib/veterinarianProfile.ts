export function doctorName(name: string | null | undefined) {
  const clean = name?.trim();
  if (!clean) return "Veterinarian";
  return /^dr\.?\s/i.test(clean) ? clean : `Dr. ${clean}`;
}

export function profileIdFromName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/^dr\.?\s+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `vet-${slug}` : `vet-${Date.now()}`;
}
