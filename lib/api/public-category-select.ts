import type { Prisma } from "@prisma/client";

export const PUBLIC_CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  image: true,
  parentId: true,
  sortOrder: true,
  _count: { select: { products: { where: { status: "ACTIVE" } } } },
} satisfies Prisma.CategorySelect;

type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof PUBLIC_CATEGORY_SELECT }>;

interface CategoryDTO {
  name: string;
  slug: string;
  image: string | null;
  productCount: number;
  children: CategoryDTO[];
}

function toCategoryDTO(row: CategoryRow): CategoryDTO {
  return {
    name: row.name,
    slug: row.slug,
    image: row.image,
    productCount: row._count.products,
    children: [],
  };
}

/** Flat list, sorted by sortOrder then name — used when ?flat=true. */
export function toFlatCategoryList(rows: CategoryRow[]): CategoryDTO[] {
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map(toCategoryDTO);
}

/** Nested tree, root categories with children attached — the default shape. */
export function toCategoryTree(rows: CategoryRow[]): CategoryDTO[] {
  const byId = new Map<string, CategoryDTO & { _sortOrder: number; _parentId: string | null }>();

  for (const row of rows) {
    byId.set(row.id, { ...toCategoryDTO(row), _sortOrder: row.sortOrder, _parentId: row.parentId });
  }

  const roots: (CategoryDTO & { _sortOrder: number })[] = [];

  for (const row of rows) {
    const node = byId.get(row.id)!;
    if (row.parentId && byId.has(row.parentId)) {
      byId.get(row.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortTree = (nodes: (CategoryDTO & { _sortOrder?: number })[]): CategoryDTO[] =>
    [...nodes]
      .sort((a, b) => (a._sortOrder ?? 0) - (b._sortOrder ?? 0) || a.name.localeCompare(b.name))
      .map((node) => ({
        name: node.name,
        slug: node.slug,
        image: node.image,
        productCount: node.productCount,
        children: sortTree(node.children as (CategoryDTO & { _sortOrder?: number })[]),
      }));

  return sortTree(roots);
}
