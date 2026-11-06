import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Paths reserved for Super Admin and Technical Support; Support Admin is redirected,
// not just visually blocked, so there's no client-side data flash.
// Previously this checked bare "/settings" and "/staff", which never
// matched anything — the real pages live under "/admin/settings" and
// "/admin/staff". That meant this restriction silently never applied to
// the actual Staff page. Fixed to match the real paths.
// /admin/settings is deliberately NOT here — Support Admin needs access
// too (their own password, and whatever they're permitted to see there);
// the page component itself conditionally shows the Super-Admin-only
// sections (WhatsApp config, Branding, Payments) rather than gating the
// whole route.
const SUPER_ADMIN_ONLY_PREFIXES = ["/admin/staff", "/admin/categories"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const isAdminRoute = pathname.startsWith("/admin");

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
  matcher: ["/admin/:path*"],
};
