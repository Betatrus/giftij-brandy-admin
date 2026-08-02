import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Paths only a Super Admin may even load — Support Admin is redirected,
// not just visually blocked, so there's no client-side data flash.
const SUPER_ADMIN_ONLY_PREFIXES = ["/settings", "/staff"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const isAdminRoute = pathname.startsWith("/admin") || pathname.startsWith("/settings") || pathname.startsWith("/staff");

  if (!isAdminRoute) return NextResponse.next();

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const role = req.auth?.user?.role;
  const isRestricted = SUPER_ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p));

  if (isRestricted && role !== "SUPER_ADMIN") {
    return NextResponse.redirect(new URL("/admin/dashboard?denied=1", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*", "/settings/:path*", "/staff/:path*"],
};
