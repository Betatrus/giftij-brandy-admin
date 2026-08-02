/**
 * Converts a name into a URL-safe slug: lowercase, hyphenated, no accents
 * or special characters. Used for both Product and Category slugs.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Generates a unique slug by appending -2, -3, etc. if the base slug is
 * already taken. `checkExists` should return true if the given slug is
 * already in use (excluding the current record being saved, if editing).
 */
export async function generateUniqueSlug(
  name: string,
  checkExists: (slug: string) => Promise<boolean>
): Promise<string> {
  const base = slugify(name) || "item";
  let candidate = base;
  let suffix = 2;

  while (await checkExists(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}
