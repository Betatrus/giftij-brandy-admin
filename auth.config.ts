import type { NextAuthConfig } from "next-auth";
import type { StaffRole } from "@prisma/client";

// This configuration is safe to import from the Worker middleware runtime:
// it contains no Prisma adapter, database access, or Node-only password code.
const authConfig = {
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
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

export default authConfig;
