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
  return generateUniqueValue(slugify(name) || "item", checkExists, (base, n) => `${base}-${n}`);
}

/**
 * Generates a unique SKU from a base string (e.g. an existing SKU plus a
 * "-COPY" suffix, for product duplication) by appending -2, -3, etc. if
 * taken. No slugify transformation — SKUs keep whatever casing/format the
 * admin already used.
 */
export async function generateUniqueSku(
  baseSku: string,
  checkExists: (sku: string) => Promise<boolean>
): Promise<string> {
  return generateUniqueValue(baseSku, checkExists, (base, n) => `${base}-${n}`);
}

async function generateUniqueValue(
  base: string,
  checkExists: (candidate: string) => Promise<boolean>,
  suffix: (base: string, n: number) => string
): Promise<string> {
  let candidate = base;
  let n = 2;

  while (await checkExists(candidate)) {
    candidate = suffix(base, n);
    n += 1;
  }

  return candidate;
}
