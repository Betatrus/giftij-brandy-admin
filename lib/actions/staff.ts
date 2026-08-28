"use server";

import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-log";
import {
  createStaffSchema,
  resetPasswordSchema,
  changeOwnPasswordSchema,
  type CreateStaffInput,
  type ResetPasswordInput,
  type ChangeOwnPasswordInput,
} from "@/lib/validators/staff";
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
 * Development/testing convenience (§19) — permanently removes a staff
 * account rather than just deactivating it. Same self-protection as
 * every other staff action here: never your own account, and never the
 * last remaining Super Admin (deactivating down to zero admins is
 * already an unrecoverable lockout; deleting is worse, since there'd be
 * no account left to even reactivate). If the account has inventory/
 * activity history attached, the database's own foreign-key rules decide
 * whether that's set-null or blocked — surfaced here as a friendly
 * message either way, never a raw stack trace.
 */
export async function deleteStaff(userId: string) {
  const session = await requireStaffManager();

  if (userId === session.user.id) {
    throw new Error("You cannot delete your own account.");
  }

  const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (target.role === "SUPER_ADMIN") {
    const superAdminCount = await prisma.user.count({ where: { role: "SUPER_ADMIN" } });
    if (superAdminCount <= 1) {
      throw new Error("Cannot delete the only remaining Super Admin account.");
    }
  }

  try {
    await prisma.user.delete({ where: { id: userId } });
  } catch {
    throw new Error(
      "This account has activity history tied to it and can't be permanently deleted. Revoke their access instead."
    );
  }

  await logActivity({
    userId: session.user.id,
    action: "STAFF_DELETE",
    resource: `User:${userId}`,
    metadata: { name: target.name, email: target.email },
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

/**
 * Self-service — available to BOTH roles for their OWN account only (no
 * userId parameter; always acts on the caller's own session). Requires
 * the current password, verified via bcrypt, before allowing a change —
 * unlike resetStaffPassword above, which is a Super Admin overriding
 * someone else's password without knowing it. Genuinely different
 * operations, kept as two separate functions rather than one with a
 * conditional, so neither code path can accidentally skip the check the
 * other relies on.
 */
export async function changeOwnPassword(input: ChangeOwnPasswordInput) {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");

  const parsed = changeOwnPasswordSchema.parse(input);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
  const currentPasswordValid = await bcrypt.compare(parsed.currentPassword, user.passwordHash);
  if (!currentPasswordValid) {
    throw new Error("Your current password is incorrect.");
  }

  const passwordHash = await bcrypt.hash(parsed.newPassword, 12);
  await prisma.user.update({ where: { id: session.user.id }, data: { passwordHash } });

  await logActivity({
    userId: session.user.id,
    action: "OWN_PASSWORD_CHANGE",
    resource: `User:${session.user.id}`,
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
