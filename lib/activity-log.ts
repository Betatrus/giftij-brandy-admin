import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Either `userId` (an admin's own action) or `systemSource` (a backend
 * process acting on its own — e.g. the Paystack webhook creating an
 * order) must be provided, matching ActivityLog's schema comment
 * ("systemSource — set when userId is null", e.g. "paystack_webhook").
 * Never both, never neither.
 */
type LogActivityParams =
  | { userId: string; systemSource?: never; action: string; resource: string; metadata?: Prisma.InputJsonValue }
  | { userId?: never; systemSource: string; action: string; resource: string; metadata?: Prisma.InputJsonValue };

export async function logActivity(params: LogActivityParams) {
  await prisma.activityLog.create({
    data: {
      userId: params.userId ?? null,
      systemSource: params.systemSource ?? null,
      action: params.action,
      resource: params.resource,
      metadata: params.metadata,
    },
  });
}