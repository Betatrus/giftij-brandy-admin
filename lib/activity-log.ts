import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function logActivity(params: {
  userId: string;
  action: string;
  resource: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.activityLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      resource: params.resource,
      metadata: params.metadata,
    },
  });
}