import NextAuth from "next-auth";
import authConfig from "@/auth.config";
import { NextResponse } from "next/server";

// Middleware only verifies the JWT/session. Database access and credentials
// verification remain in the Node-compatible Auth.js route/runtime.
const { auth } = NextAuth(authConfig);
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

export const config = { matcher: ["/admin/:path*"] };
