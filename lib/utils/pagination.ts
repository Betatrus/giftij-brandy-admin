export const DEFAULT_PAGE_SIZE = 20;

export function getPagination(page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE) {
  const safePage = Math.max(1, page);
  const safeSize = Math.min(100, Math.max(1, pageSize));
  return {
    skip: (safePage - 1) * safeSize,
    take: safeSize,
    page: safePage,
    pageSize: safeSize,
  };
}

export function getPageCount(totalItems: number, pageSize: number = DEFAULT_PAGE_SIZE) {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}
