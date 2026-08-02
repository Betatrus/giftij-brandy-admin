import { NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api/respond";
import { ApiError } from "@/lib/api/api-error";
import { withCors, corsPreflight } from "@/lib/api/cors";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { categoryListQuerySchema } from "@/lib/validators/public/categories";
import { PUBLIC_CATEGORY_SELECT, toCategoryTree, toFlatCategoryList } from "@/lib/api/public-category-select";

const getCachedCategories = unstable_cache(
  async () => {
    return prisma.category.findMany({
      where: { isActive: true },
      select: PUBLIC_CATEGORY_SELECT,
    });
  },
  ["public-categories"],
  { tags: ["categories"], revalidate: 60 }
);

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");

  try {
    const ip = getClientIp(req);
    const rateLimit = checkRateLimit(`public:categories:${ip}`, 120, 60_000);
    if (!rateLimit.allowed) {
      throw new ApiError("RATE_LIMITED", "Too many requests. Please try again shortly.");
    }

    const { flat } = categoryListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const rows = await getCachedCategories();
    const data = flat ? toFlatCategoryList(rows) : toCategoryTree(rows);

    return withCors(ok(data), origin);
  } catch (error) {
    return withCors(fail(error), origin);
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req.headers.get("origin"));
}
