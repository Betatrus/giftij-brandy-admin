import type { NextAuthConfig } from "next-auth";
import type { StaffRole } from "@prisma/client";

/**
 * Edge-safe Auth.js configuration.
 *
 * Keep database adapters, Prisma, password hashing and other Node-only
 * dependencies in auth.ts. Middleware only needs to validate the JWT and
 * read the role already stored in it.
 */
export const authConfig = {
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: StaffRole }).role;
        token.id = user.id as string;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as StaffRole;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
