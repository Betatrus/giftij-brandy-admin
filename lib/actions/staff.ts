"use server";

import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-log";
import { createStaffSchema, resetPasswordSchema, type CreateStaffInput, type ResetPasswordInput } from "@/lib/validators/staff";
import { revalidatePath } from "next/cache";

async function requireStaffManager() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  if (!hasPermission(session.user.role, "staff:manage")) {
    throw new Error("FORBIDDEN: staff management requires Super Admin access");
  }
  return session;
}

export async function listStaff() {
  await requireStaffManager();
  return prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function createStaff(input: CreateStaffInput) {
  const session = await requireStaffManager();
  const parsed = createStaffSchema.parse(input);

  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) {
    throw new Error("A staff account with this email already exists.");
  }

  const passwordHash = await bcrypt.hash(parsed.password, 12);

  const user = await prisma.user.create({
    data: { name: parsed.name, email: parsed.email, passwordHash, role: parsed.role },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
  });

  await logActivity({
    userId: session.user.id,
    action: "STAFF_CREATE",
    resource: `User:${user.id}`,
    metadata: { name: user.name, email: user.email, role: user.role },
  });

  revalidatePath("/admin/staff");
  return user;
}

export async function updateStaffRole(userId: string, role: "SUPER_ADMIN" | "SUPPORT_ADMIN") {
  const session = await requireStaffManager();

  if (userId === session.user.id && role !== "SUPER_ADMIN") {
    throw new Error("You cannot remove your own Super Admin access.");
  }

  await prisma.user.update({ where: { id: userId }, data: { role } });

  await logActivity({
    userId: session.user.id,
    action: "STAFF_ROLE_CHANGE",
    resource: `User:${userId}`,
    metadata: { newRole: role },
  });

  revalidatePath("/admin/staff");
}

export async function toggleStaffActive(userId: string, isActive: boolean) {
  const session = await requireStaffManager();

  if (userId === session.user.id && !isActive) {
    throw new Error("You cannot revoke your own access.");
  }

  await prisma.user.update({ where: { id: userId }, data: { isActive } });

  await logActivity({
    userId: session.user.id,
    action: isActive ? "STAFF_REACTIVATE" : "STAFF_ACCESS_REVOKE",
    resource: `User:${userId}`,
  });

  revalidatePath("/admin/staff");
}

/**
 * Super Admin sets a new password directly, on behalf of a staff member.
 * Not a self-service "forgot password" flow — that would need an email
 * token system (Resend is already wired up for this project, but building
 * a full reset-token flow is more scope than "reset a colleague's
 * password" needs for MVP). Worth flagging as a future enhancement if
 * self-service reset becomes a real need.
 */
export async function resetStaffPassword(userId: string, input: ResetPasswordInput) {
  const session = await requireStaffManager();
  const parsed = resetPasswordSchema.parse(input);

  const passwordHash = await bcrypt.hash(parsed.newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  await logActivity({
    userId: session.user.id,
    action: "STAFF_PASSWORD_RESET",
    resource: `User:${userId}`,
  });
}

export async function getStaffActivity(userId: string) {
  await requireStaffManager();
  return prisma.activityLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}
