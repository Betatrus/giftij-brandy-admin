import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

// Middleware uses only the Edge-safe JWT configuration. It must not import
// auth.ts, Prisma, the Prisma adapter, or bcryptjs.
const { auth } = NextAuth(authConfig);

// Paths reserved for Super Admin and Technical Support; Support Admin is redirected,
// not just visually blocked, so there's no client-side data flash.
const SUPER_ADMIN_ONLY_PREFIXES = ["/admin/staff", "/admin/categories"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const host = req.headers.get("host")?.split(":")[0]?.toLowerCase();
  const isLoggedIn = !!req.auth;
  const isAdminRoute = pathname.startsWith("/admin");

  // The api subdomain is intentionally routed to this project. Its root is
  // a public, read-only health document; admin routes remain protected below.
  if (host === "api.giftijbrandy.com" && pathname === "/") {
    return NextResponse.json({
      service: "Giftij Brandy API",
      status: "ok",
      message: "API is online.",
      timestamp: new Date().toISOString(),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (!isAdminRoute) return NextResponse.next();

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const role = req.auth?.user?.role;
  const isRestricted = SUPER_ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p));

  if (isRestricted && role !== "SUPER_ADMIN" && role !== "TECHNICAL_SUPPORT") {
    return NextResponse.redirect(new URL("/admin/dashboard?denied=1", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/", "/admin/:path*"],
};
