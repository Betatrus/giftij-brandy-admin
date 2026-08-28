"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-log";
import { recordCustomerEvent } from "@/lib/customers/identity";
import { sendEmail } from "@/lib/resend";
import { sendCustomerEmailSchema, type SendCustomerEmailInput } from "@/lib/validators/communication";
import { revalidatePath } from "next/cache";

async function requireCommsAccess(write = false) {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  const permission = write ? "communications:write" : "communications:read";
  if (!hasPermission(session.user.role, permission)) {
    throw new Error(`FORBIDDEN: you do not have permission to ${write ? "send" : "view"} communications`);
  }
  return session;
}

/** Lightweight search for the composer's recipient picker — top 20 matches, not the full paginated Customers list (Phase 3's listCustomers). */
export async function searchCustomersLite(query: string) {
  await requireCommsAccess();
  if (!query.trim()) return [];

  return prisma.customer.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    take: 20,
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
}

/**
 * Customers with at least one failed Paystack attempt in the last 30
 * days — a one-click recipient shortcut for recovery outreach (§42:
 * "Contact customers associated with failed payments"), reusing the
 * CustomerEvent "PAYMENT_FAILED" records the Phase 2 webhook already
 * writes.
 */
export async function listFailedPaymentCustomers() {
  await requireCommsAccess();

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const events = await prisma.customerEvent.findMany({
    where: { label: "PAYMENT_FAILED", createdAt: { gte: since } },
    select: { customer: { select: { id: true, name: true, email: true } } },
    distinct: ["customerId"],
    orderBy: { createdAt: "desc" },
  });

  return events.map((e) => e.customer);
}

function personalize(template: string, firstName: string): string {
  return template.replace(/\{\{firstName\}\}/g, firstName);
}

/** Converts the composer's plain-text message into minimal HTML — paragraphs on blank lines, line breaks preserved. Not a rich editor; §42 explicitly rules out building a full marketing platform. */
function toSimpleHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = escaped.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`);
  return paragraphs.join("\n");
}

/**
 * Sends immediately (§42: "Send Now" — no scheduling in this MVP,
 * matching Campaign.status's SCHEDULED value existing in the schema but
 * unused here). One Resend call per recipient (not a single bulk send)
 * so `{{firstName}}` personalization is genuinely per-recipient, and so
 * one bad email address can't fail the whole batch — failures are
 * collected and reported back rather than throwing on the first one.
 */
export async function sendCustomerEmail(input: SendCustomerEmailInput) {
  const session = await requireCommsAccess(true);
  const parsed = sendCustomerEmailSchema.parse(input);

  const customers = await prisma.customer.findMany({
    where: { id: { in: parsed.customerIds } },
    select: { id: true, name: true, email: true },
  });

  const campaign = await prisma.campaign.create({
    data: {
      subject: parsed.subject,
      bodyHtml: toSimpleHtml(parsed.message),
      recipientRule: { type: "explicit", customerIds: parsed.customerIds },
      status: "SENDING",
    },
  });

  const results: { customerId: string; email: string; success: boolean; error?: string }[] = [];

  for (const customer of customers) {
    const firstName = customer.name.trim().split(/\s+/)[0] || customer.name;
    try {
      await sendEmail({
        to: customer.email,
        subject: personalize(parsed.subject, firstName),
        html: toSimpleHtml(personalize(parsed.message, firstName)),
      });
      await recordCustomerEvent(customer.id, "EMAIL_SENT", { campaignId: campaign.id, subject: parsed.subject });
      results.push({ customerId: customer.id, email: customer.email, success: true });
    } catch (err) {
      results.push({
        customerId: customer.id,
        email: customer.email,
        success: false,
        error: err instanceof Error ? err.message : "Send failed",
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status: "SENT",
      sentAt: new Date(),
      stats: { recipientCount: customers.length, successCount, failureCount: customers.length - successCount },
    },
  });

  await logActivity({
    userId: session.user.id,
    action: "CUSTOMER_EMAIL_SENT",
    resource: `Campaign:${campaign.id}`,
    metadata: { recipientCount: customers.length, successCount, subject: parsed.subject },
  });

  revalidatePath("/admin/communications");

  return { campaignId: campaign.id, results, successCount, failureCount: customers.length - successCount };
}

/** Recent send history — simple chronological list, no filtering (§42 scope: "not a full marketing automation platform"). */
export async function listSentCampaigns() {
  await requireCommsAccess();

  return prisma.campaign.findMany({
    where: { status: "SENT" },
    orderBy: { sentAt: "desc" },
    take: 20,
    select: { id: true, subject: true, sentAt: true, stats: true },
  });
}
