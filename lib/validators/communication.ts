import { z } from "zod";

export const sendCustomerEmailSchema = z.object({
  customerIds: z.array(z.string()).min(1, "Select at least one customer"),
  subject: z.string().min(1, "Subject is required"),
  // Plain text with {{firstName}} tokens — converted to simple HTML at
  // send time (lib/actions/communications.ts). Deliberately not a rich
  // HTML editor: "Do not build a full marketing automation platform" (§42).
  message: z.string().min(1, "Message is required"),
});

export type SendCustomerEmailInput = z.infer<typeof sendCustomerEmailSchema>;
