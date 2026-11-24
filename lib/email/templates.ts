import type { EmailEventType } from "@prisma/client";
type Item = { name?: string; variant?: string | null; quantity?: number };
type Payload = Record<string, unknown>;
const asPayload = (v: unknown): Payload => v && typeof v === "object" && !Array.isArray(v) ? v as Payload : {};
const str = (v: unknown, fallback = ""): string => typeof v === "string" && v.trim() ? v.trim() : fallback;
const escapeHtml = (v: string): string => {
  const replacements: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return v.replace(/[&<>"']/g, (character) => replacements[character] ?? character);
};
const money = (v: unknown): string => {
  const amount = typeof v === "number" ? v : Number(v);
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(amount) : "Not available";
};
function itemMarkup(value: unknown): { html: string; plain: string } {
  if (!Array.isArray(value)) return { html: "", plain: "" };
  const items = value.filter((item): item is Item => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  const html = items.length ? `<h3>Items</h3><ul>${items.map((item) => `<li>${escapeHtml(str(item.name, "Giftij Brandy item"))}${str(item.variant) ? ` — ${escapeHtml(str(item.variant))}` : ""} × ${Number.isInteger(item.quantity) ? item.quantity : 1}</li>`).join("")}</ul>` : "";
  const plain = items.map((item) => `• ${str(item.name, "Giftij Brandy item")}${str(item.variant) ? ` — ${str(item.variant)}` : ""} × ${Number.isInteger(item.quantity) ? item.quantity : 1}`).join("\n");
  return { html, plain };
}
export function renderTransactionalEmail(eventType: EmailEventType, value: unknown): { subject: string; html: string; text: string } {
  const p = asPayload(value);
  const customer = str(p.customerName, "there");
  const order = str(p.orderNumber);
  const reference = str(p.reference);
  const reason = str(p.reason);
  const items = itemMarkup(p.items);
  const orderLine = order ? `<p><strong>Order number:</strong> ${escapeHtml(order)}</p>` : "";
  const refLine = reference ? `<p><strong>Payment reference:</strong> ${escapeHtml(reference)}</p>` : "";
  const subtotal = p.subtotal !== undefined ? `<p><strong>Order subtotal:</strong> ${escapeHtml(money(p.subtotal))}</p>` : "";
  let subject = "An update from Giftij Brandy", heading = "An update on your order", intro = "We have an update about your Giftij Brandy purchase.", extraHtml = "", extraText = "";
  switch (eventType) {
    case "CHECKOUT_EXPIRED":
      subject = "Your Giftij Brandy checkout has expired"; heading = "Your checkout session expired";
      intro = "Your 10-minute checkout reservation expired before Paystack confirmed a successful payment. The reserved stock has been released and no order was created.";
      extraHtml = refLine; extraText = reference ? `Payment reference: ${reference}\n` : ""; break;
    case "PAYMENT_FAILED":
      subject = "Your Giftij Brandy payment was not completed"; heading = "Payment was not completed";
      intro = "Paystack did not confirm a successful payment for this attempt. The checkout reservation has been released. If your bank shows a debit, please contact Customer Care before trying again.";
      extraHtml = refLine + (p.amountNaira !== undefined && p.amountNaira !== null ? `<p><strong>Attempted amount:</strong> ${escapeHtml(money(p.amountNaira))}</p>` : "");
      extraText = (reference ? `Payment reference: ${reference}\n` : "") + (p.amountNaira !== undefined && p.amountNaira !== null ? `Attempted amount: ${money(p.amountNaira)}\n` : ""); break;
    case "ORDER_CONFIRMED":
      subject = `Payment received — order ${order} confirmed`; heading = "Your order is confirmed";
      intro = "Your payment has been verified successfully and your Giftij Brandy order has been created.";
      extraHtml = orderLine + subtotal; extraText = `Order number: ${order}\nOrder subtotal: ${money(p.subtotal)}\n`;
      if (p.stockUnavailable === true) { extraHtml += "<p>Our team will contact you to resolve a stock availability issue. Your payment is recorded; no unavailable stock was deducted.</p>"; extraText += "Our team will contact you to resolve a stock availability issue.\n"; } break;
    case "ORDER_PROCESSING":
      subject = `Your Giftij Brandy order ${order} is being processed`; heading = "Your order is being processed";
      intro = "Our team has started working on your order. We will send another update when it is completed.";
      extraHtml = orderLine + subtotal; extraText = `Order number: ${order}\n`; break;
    case "ORDER_COMPLETED":
      subject = `Your Giftij Brandy order ${order} has been completed`; heading = "Your order has been completed";
      intro = "Your order has been marked as completed by our team.";
      extraHtml = orderLine + (str(p.trackingNumber) ? `<p><strong>Tracking reference:</strong> ${escapeHtml(str(p.trackingNumber))}</p>` : "");
      extraText = `Order number: ${order}\n` + (str(p.trackingNumber) ? `Tracking reference: ${str(p.trackingNumber)}\n` : ""); break;
    case "ORDER_CANCELLED":
      subject = `An update about Giftij Brandy order ${order}`; heading = "Your cancellation was approved";
      intro = "Your cancellation review has been approved and the order has been cancelled.";
      extraHtml = orderLine + (reason ? `<p><strong>Update:</strong> ${escapeHtml(reason)}</p>` : "") + "<p>If a refund is due, we will send a separate confirmation once it has been completed. This cancellation notice does not mean a refund has already been issued.</p>";
      extraText = `Order number: ${order}\n${reason ? `Update: ${reason}\n` : ""}A separate confirmation will be sent if a refund is completed.\n`; break;
    case "ORDER_REFUNDED":
      subject = `Your Giftij Brandy refund for order ${order} is complete`; heading = "Your refund is complete";
      intro = "The refund for the returned item below has been marked as completed by our team.";
      extraHtml = orderLine + (p.refundAmount !== null && p.refundAmount !== undefined ? `<p><strong>Refund amount:</strong> ${escapeHtml(money(p.refundAmount))}</p>` : "") + (p.productName ? `<p><strong>Item:</strong> ${escapeHtml(str(p.productName))} × ${Number(p.quantityReturned) || 1}</p>` : "");
      extraText = `Order number: ${order}\n` + (p.refundAmount !== null && p.refundAmount !== undefined ? `Refund amount: ${money(p.refundAmount)}\n` : "") + (p.productName ? `Item: ${str(p.productName)} × ${Number(p.quantityReturned) || 1}\n` : ""); break;
  }
  const html = `<!doctype html><html><body style="margin:0;background:#f6f4f1;font-family:Arial,sans-serif;color:#24211f"><div style="max-width:620px;margin:32px auto;padding:32px;background:#fff;border-radius:12px"><p style="font-size:13px;letter-spacing:2px;font-weight:bold;color:#795b42">GIFTIJ BRANDY</p><h1 style="font-size:24px;margin:24px 0 12px">${escapeHtml(heading)}</h1><p>Hello ${escapeHtml(customer)},</p><p style="line-height:1.65">${escapeHtml(intro)}</p>${extraHtml}${items.html}<p style="margin-top:28px">Thank you for choosing Giftij Brandy.</p><p style="color:#777;font-size:12px">If you need help, please contact our Customer Care team.</p></div></body></html>`;
  const plain = `GIFTIJ BRANDY\n\n${heading}\n\nHello ${customer},\n\n${intro}\n\n${extraText}${items.plain ? `\nItems:\n${items.plain}\n` : ""}\nThank you for choosing Giftij Brandy.\n`;
  return { subject, html, text: plain };
}
