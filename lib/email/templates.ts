import type { EmailEventType } from "@prisma/client";

type Item = { name?: string; slug?: string; variant?: string | null; quantity?: number; unitPrice?: number | string | null };
type Payload = Record<string, unknown>;

const SUPPORT_EMAIL = "jacobsgift3@gmail.com";
const SUPPORT_WHATSAPP = "https://wa.me/2349023021320";
const BRAND_GOLD = "#D8BD83";
const INK = "#292722";
const MUTED = "#77736B";

const asPayload = (value: unknown): Payload =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Payload : {};

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const escapeHtml = (value: string): string => {
  const replacements: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => replacements[character] ?? character);
};

const money = (value: unknown): string => {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(amount)
    : "Not available";
};

const dateLabel = (value: unknown): string => {
  if (typeof value !== "string" && !(value instanceof Date)) return "Not available";
  const date = new Date(value instanceof Date ? value.toISOString() : value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "Africa/Lagos",
  }).format(date);
};

function orderItems(value: unknown): { html: string; plain: string; shopLinksHtml: string; subtotal: number; count: number } {
  if (!Array.isArray(value)) return { html: "", plain: "", shopLinksHtml: "", subtotal: 0, count: 0 };
  const items = value.filter((item): item is Item => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  if (!items.length) return { html: "", plain: "", shopLinksHtml: "", subtotal: 0, count: 0 };

  const rows = items.map((item) => {
    const name = str(item.name, "Giftij Brandy item");
    const variant = str(item.variant);
    const quantity = Number.isInteger(item.quantity) && Number(item.quantity) > 0 ? Number(item.quantity) : 1;
    const unitPrice = item.unitPrice === null || item.unitPrice === undefined ? null : Number(item.unitPrice);
    const lineAmount = unitPrice !== null && Number.isFinite(unitPrice) ? unitPrice * quantity : null;
    const lineTotal = lineAmount !== null ? money(lineAmount) : "—";
    const productUrl = typeof item.slug === "string" && item.slug.trim()
      ? `https://www.giftijbrandy.com/product/${encodeURIComponent(item.slug.trim())}`
      : "";
    const linkedName = productUrl
      ? `<a href="${escapeHtml(productUrl)}" style="color:#6f5a35;text-decoration:underline">${escapeHtml(name)}</a>`
      : escapeHtml(name);
    return {
      amount: lineAmount,
      quantity,
      html: `<tr>
        <td style="padding:13px 10px;border-bottom:1px solid #eeeae2;color:${INK};font-size:15px;line-height:1.45">
          <strong style="font-weight:600">${linkedName}</strong>${variant ? `<br><span style="font-size:13px;color:${MUTED}">${escapeHtml(variant)}</span>` : ""}
        </td>
        <td align="center" style="padding:13px 8px;border-bottom:1px solid #eeeae2;color:#514d45;font-size:15px">${quantity}</td>
        <td align="right" style="padding:13px 10px;border-bottom:1px solid #eeeae2;color:${INK};font-size:15px;white-space:nowrap">${escapeHtml(lineTotal)}</td>
      </tr>`,
      plain: `• ${name}${variant ? ` — ${variant}` : ""} | Qty: ${quantity} | ${lineTotal}${productUrl ? ` | Shop here: ${productUrl}` : ""}`,
      shopLinkHtml: productUrl ? `<p style="margin:8px 0 0"><a href="${escapeHtml(productUrl)}" style="display:inline-block;color:#6f5a35;font-size:18px;font-weight:700;text-decoration:underline">Shop here</a></p>` : "",
    };
  });
  const subtotal = rows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
  const count = rows.reduce((sum, row) => sum + row.quantity, 0);

  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:14px 0 8px">
      <thead><tr>
        <th align="left" style="padding:10px;color:#77736B;font-size:12px;letter-spacing:.7px;text-transform:uppercase;border-bottom:1px solid ${BRAND_GOLD}">Item</th>
        <th align="center" style="padding:10px;color:#77736B;font-size:12px;letter-spacing:.7px;text-transform:uppercase;border-bottom:1px solid ${BRAND_GOLD}">Qty</th>
        <th align="right" style="padding:10px;color:#77736B;font-size:12px;letter-spacing:.7px;text-transform:uppercase;border-bottom:1px solid ${BRAND_GOLD}">Amount</th>
      </tr></thead><tbody>${rows.map((row) => row.html).join("")}</tbody>
    </table>`,
    plain: rows.map((row) => row.plain).join("\n"),
    shopLinksHtml: rows.map((row) => row.shopLinkHtml).join(""),
    subtotal,
    count,
  };
}

function footerHtml(year: number): string {
  return `<tr><td style="padding:24px 28px 28px;background:#faf9f6;border-top:1px solid #eeeae2">
    <p style="margin:0 0 10px;color:#77736B;font-size:12px;line-height:1.6">
      This is an automated email address and is not monitored. Please do not reply to this email.
    </p>
    <p style="margin:0 0 10px;color:#77736B;font-size:12px;line-height:1.7">
      For enquiries or assistance, kindly contact us through:<br>
      Email: <a href="mailto:${SUPPORT_EMAIL}" style="color:#6f5a35;text-decoration:underline">${SUPPORT_EMAIL}</a><br>
      WhatsApp: <a href="${SUPPORT_WHATSAPP}" style="color:#6f5a35;text-decoration:underline">Chat with our support team</a>
    </p>
    <p style="margin:14px 0 0;color:#99948a;font-size:11px;line-height:1.5">© ${year} Giftij Brandy. All rights reserved.</p>
  </td></tr>`;
}

export function renderTransactionalEmail(eventType: EmailEventType, value: unknown): { subject: string; html: string; text: string } {
  const payload = asPayload(value);
  const customer = str(payload.customerName, "there");
  const orderNumber = str(payload.orderNumber);
  const reference = str(payload.reference);
  const reason = str(payload.reason);
  const itemSummary = orderItems(payload.items);
  const orderDate = dateLabel(payload.orderDate);
  const orderStatus = str(payload.orderStatus, "Confirmed — awaiting processing");
  const totalPaid = payload.totalPaid ?? payload.subtotal;
  const logoUrl = process.env.BREVO_LOGO_URL?.trim();
  const safeLogoUrl = logoUrl && /^https:\/\//i.test(logoUrl) ? logoUrl : "";
  const year = new Date().getFullYear();

  let subject = "An update from Giftij Brandy";
  let heading = "A little update from us";
  let intro = "There is an update about your Giftij Brandy purchase.";
  let detailHtml = "";
  let detailText = "";

  const orderNumberRow = orderNumber
    ? `<tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Order number</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px;font-weight:600">${escapeHtml(orderNumber)}</td></tr>`
    : "";
  const dateRow = payload.orderDate
    ? `<tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Date</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px">${escapeHtml(orderDate)}</td></tr>`
    : "";
  const statusRow = orderNumber
    ? `<tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Order status</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px">${escapeHtml(orderStatus)}</td></tr>`
    : "";
  const summaryCard = (rows: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background:#fbfaf7;border:1px solid #eeeae2;border-radius:8px;margin:18px 0 22px"><tr><td style="padding:14px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr></table>`;

  switch (eventType) {
    case "RESERVATION_CREATED": {
      const placedAt = dateLabel(payload.placedAt);
      const expiresAt = dateLabel(payload.expiresAt);
      const subtotal = payload.subtotal ?? itemSummary.subtotal;
      const processingFee = payload.estimatedProcessingFee ?? 0;
      const estimatedTotal = payload.estimatedTotal ?? Number(subtotal) + Number(processingFee);
      subject = "Your Giftij Brandy order is reserved";
      heading = "Your order";
      intro = `We’ve received your order and reserved your selected items for 10 minutes while you complete payment. Please complete checkout before ${expiresAt} WAT so your items remain held for you.`;
      const rows = `<tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Reservation Reference</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px;font-weight:600">${escapeHtml(str(payload.reservationReference))}</td></tr><tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Placed at</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px">${escapeHtml(placedAt)}</td></tr><tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Complete payment by</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px">${escapeHtml(expiresAt)}</td></tr><tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Product subtotal</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px">${escapeHtml(money(subtotal))}</td></tr><tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Estimated processing fee</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px">${escapeHtml(money(processingFee))}</td></tr><tr><td style="padding:10px 0;color:${INK};font-size:15px;font-weight:700;border-top:1px solid ${BRAND_GOLD}">Estimated total</td><td align="right" style="padding:10px 0;color:${INK};font-size:16px;font-weight:700;border-top:1px solid ${BRAND_GOLD}">${escapeHtml(money(estimatedTotal))}</td></tr>`;
      detailHtml = `${summaryCard(rows)}<h2 style="margin:22px 0 8px;color:${INK};font-size:18px">Your reserved items</h2>${itemSummary.html}<p style="margin:16px 0 0;color:${MUTED};font-size:13px;line-height:1.7">The processing fee and total are estimates for Nigerian local payments. Paystack will show the actual processing fee during payment. This estimate is for transparency and is not added to your product subtotal by Giftij Brandy.</p>`;
      detailText = `Reservation Reference: ${str(payload.reservationReference)}\nPlaced at: ${placedAt}\nComplete payment by: ${expiresAt}\n\nYour reserved items:\n${itemSummary.plain}\n\nProduct subtotal: ${money(subtotal)}\nEstimated processing fee: ${money(processingFee)}\nEstimated total: ${money(estimatedTotal)}\n\nThe processing fee and total are estimates for Nigerian local payments. Paystack will show the actual processing fee during payment. This estimate is not added to your product subtotal by Giftij Brandy.\n`;
      break;
    }
    case "CHECKOUT_EXPIRED": {
      const deadline = dateLabel(payload.expiredAt);
      const subtotal = payload.subtotal ?? itemSummary.subtotal;
      const processingFee = payload.estimatedProcessingFee ?? 0;
      const estimatedTotal = payload.estimatedTotal ?? Number(subtotal) + Number(processingFee);
      subject = "Your Giftij Brandy order has been cancelled";
      heading = "Your order has been cancelled";
      intro = `Your order has been cancelled because payment was not completed before ${deadline} WAT. The reserved items have now been released and are available for other customers. No order was created, and no payment was recorded as successful.`;
      const cartRows = `<tr><td style="padding:7px 0;color:${MUTED};font-size:14px">Items</td><td align="right" style="padding:7px 0;color:${INK};font-size:14px">${itemSummary.count}</td></tr><tr><td style="padding:7px 0;color:${MUTED};font-size:14px">Product subtotal</td><td align="right" style="padding:7px 0;color:${INK};font-size:14px">${escapeHtml(money(subtotal))}</td></tr><tr><td style="padding:7px 0;color:${MUTED};font-size:14px">Estimated processing fee</td><td align="right" style="padding:7px 0;color:${INK};font-size:14px">${escapeHtml(money(processingFee))}</td></tr><tr><td style="padding:9px 0;color:${INK};font-size:15px;font-weight:700;border-top:1px solid ${BRAND_GOLD}">Estimated total</td><td align="right" style="padding:9px 0;color:${INK};font-size:15px;font-weight:700;border-top:1px solid ${BRAND_GOLD}">${escapeHtml(money(estimatedTotal))}</td></tr>`;
      detailHtml = `<h2 style="margin:22px 0 8px;color:${INK};font-size:18px">Your cart details</h2>${itemSummary.html}<h2 style="margin:20px 0 8px;color:${INK};font-size:18px">Cart summary</h2>${summaryCard(cartRows)}<p style="margin:18px 0 8px;color:${INK};font-size:16px;font-weight:600">Would you still like to shop these products?</p><p style="margin:0;color:${MUTED};font-size:14px;line-height:1.7">Click Shop here below to shop again. Alternatively, contact our admin team through WhatsApp or email. We’ll be happy to help.</p>${itemSummary.shopLinksHtml}<p style="margin:14px 0 0;color:${MUTED};font-size:13px;line-height:1.7">The processing fee and total are estimates. Paystack confirms the actual fee during payment; this estimate is not added to the product subtotal by Giftij Brandy.</p>`;
      detailText = `Your cart details:\n${itemSummary.plain}\n\nCart summary:\nItems: ${itemSummary.count}\nProduct subtotal: ${money(subtotal)}\nEstimated processing fee: ${money(processingFee)}\nEstimated total: ${money(estimatedTotal)}\n\nWould you still like to shop these products? Click Shop here below to shop again, or contact our admin team through WhatsApp or email.\n\nThe processing fee and total are estimates. Paystack confirms the actual fee during payment; this estimate is not added to the product subtotal by Giftij Brandy.\n`;
      break;
    }
    case "PAYMENT_FAILED":
      subject = "Your Giftij Brandy payment was not completed";
      heading = "Your payment was not completed";
      intro = "Paystack did not confirm a successful payment for this attempt, so your order has not been confirmed and the checkout reservation has been released. If your bank account was debited, please contact our support team before trying again.";
      detailHtml = `${reference ? `<p style="margin:0 0 8px;color:${MUTED};font-size:14px">Payment reference: ${escapeHtml(reference)}</p>` : ""}${payload.amountNaira !== undefined && payload.amountNaira !== null ? `<p style="margin:0;color:${MUTED};font-size:14px">Attempted amount: ${escapeHtml(money(payload.amountNaira))}</p>` : ""}`;
      detailText = `${reference ? `Payment reference: ${reference}\n` : ""}${payload.amountNaira !== undefined && payload.amountNaira !== null ? `Attempted amount: ${money(payload.amountNaira)}\n` : ""}`;
      break;
    case "ORDER_CONFIRMED":
      subject = orderNumber ? `Payment received — order ${orderNumber} confirmed` : "Your Giftij Brandy order is confirmed";
      heading = "Thank you. Your order is confirmed.";
      intro = "Your payment has been successfully verified, and your order is now safely with our team. We’re delighted you chose Giftij Brandy.";
      detailHtml = `${summaryCard(`${orderNumberRow}${statusRow}${dateRow}<tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Payment</td><td align="right" style="padding:8px 0;color:#526746;font-size:14px;font-weight:600">Successful</td></tr>`)}
        <h2 style="margin:22px 0 8px;color:${INK};font-size:18px">Your order</h2>
        ${itemSummary.html}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-top:8px"><tr><td style="padding:13px 10px;color:${INK};font-size:15px;font-weight:700;border-top:1px solid ${BRAND_GOLD}">Total paid</td><td align="right" style="padding:13px 10px;color:${INK};font-size:18px;font-weight:700;border-top:1px solid ${BRAND_GOLD}">${escapeHtml(money(totalPaid))}</td></tr></table>
        ${payload.stockUnavailable === true ? `<p style="margin:18px 0;padding:13px 15px;background:#fbf7ed;border-left:3px solid ${BRAND_GOLD};color:#5d5038;font-size:14px;line-height:1.6">Our team will contact you to resolve a stock availability issue. Your payment is recorded, and we will not allocate unavailable stock.</p>` : ""}`;
      detailText = `Order number: ${orderNumber}\nOrder status: ${orderStatus}\nPayment: Successful\nDate: ${orderDate}\n\nYour order:\n${itemSummary.plain}\n\nTotal paid: ${money(totalPaid)}\n${payload.stockUnavailable === true ? "\nOur team will contact you to resolve a stock availability issue.\n" : ""}`;
      break;
    case "CUSTOMER_SERVICE_PAYMENT_RECEIVED": {
      const shipping = asPayload(payload.shippingAddress);
      const address = [
        str(shipping.address), str(shipping.city), str(shipping.state), str(shipping.country),
      ].filter(Boolean).join(", ");
      const customerEmail = str(payload.customerEmail);
      const customerPhone = str(payload.customerPhone);
      const paymentReference = str(payload.paymentReference);
      subject = orderNumber ? `New payment received — order ${orderNumber}` : "New Giftij Brandy payment received";
      heading = "New paid order received";
      intro = "A customer has completed payment. Please review the order details below and proceed with customer service follow-up.";
      const rows = `<tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Order number</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px;font-weight:700">${escapeHtml(orderNumber)}</td></tr><tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Payment reference</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px;font-weight:600">${escapeHtml(paymentReference)}</td></tr><tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Payment received</td><td align="right" style="padding:8px 0;color:${INK};font-size:15px;font-weight:700">${escapeHtml(money(payload.totalPaid))}</td></tr><tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Customer</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px">${escapeHtml(customer)}</td></tr><tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Customer email</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px">${escapeHtml(customerEmail)}</td></tr><tr><td style="padding:8px 0;color:${MUTED};font-size:14px">WhatsApp number</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px">${escapeHtml(customerPhone || "Not provided")}</td></tr><tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Paid at</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px">${escapeHtml(orderDate)}</td></tr>`;
      detailHtml = `${summaryCard(rows)}<h2 style="margin:22px 0 8px;color:${INK};font-size:18px">Items paid for</h2>${itemSummary.html}${address ? `<h2 style="margin:22px 0 8px;color:${INK};font-size:18px">Delivery address</h2><p style="color:${INK};font-size:14px;line-height:1.7">${escapeHtml(address)}</p>` : ""}`;
      detailText = `Order number: ${orderNumber}\nPayment reference: ${paymentReference}\nPayment received: ${money(payload.totalPaid)}\nCustomer: ${customer}\nCustomer email: ${customerEmail}\nWhatsApp number: ${customerPhone || "Not provided"}\nPaid at: ${orderDate}\n\nItems paid for:\n${itemSummary.plain}\n\nDelivery address: ${address || "Not provided"}\n`;
      break;
    }
    case "ORDER_PROCESSING":
      subject = orderNumber ? `Your Giftij Brandy order ${orderNumber} is being prepared` : "Your Giftij Brandy order is being prepared";
      heading = "We’re getting your order ready";
      intro = "Our team has started processing your order. We’ll keep you informed as it moves through the next stage.";
      detailHtml = summaryCard(orderNumberRow);
      detailText = orderNumber ? `Order number: ${orderNumber}\n` : "";
      break;
    case "ORDER_COMPLETED":
      subject = orderNumber ? `Your Giftij Brandy order ${orderNumber} is complete` : "Your Giftij Brandy order is complete";
      heading = "Your order is complete";
      intro = "Your order has been marked as completed by our team, and dispatch is on the way!! Thank you for shopping with Giftij Brandy—we hope you enjoy your purchase.";
      detailHtml = `<h2 style="margin:22px 0 8px;color:${INK};font-size:18px">Your order details</h2>${summaryCard(`${orderNumberRow}${payload.orderDate ? dateRow : ""}${payload.trackingNumber ? `<tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Tracking reference</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px">${escapeHtml(str(payload.trackingNumber))}</td></tr>` : ""}`)}${itemSummary.html}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-top:8px"><tr><td style="padding:13px 10px;color:${INK};font-size:15px;font-weight:700;border-top:1px solid ${BRAND_GOLD}">Order subtotal</td><td align="right" style="padding:13px 10px;color:${INK};font-size:16px;font-weight:700;border-top:1px solid ${BRAND_GOLD}">${escapeHtml(money(payload.subtotal))}</td></tr></table>`;
      detailText = `Order number: ${orderNumber}\n${payload.orderDate ? `Date: ${orderDate}\n` : ""}${str(payload.trackingNumber) ? `Tracking reference: ${str(payload.trackingNumber)}\n` : ""}\nOrder details:\n${itemSummary.plain}\nOrder subtotal: ${money(payload.subtotal)}\n`;
      break;
    case "ORDER_CANCELLED":
      subject = orderNumber ? `An update about your Giftij Brandy order ${orderNumber}` : "An update about your Giftij Brandy order";
      heading = "Your order has been cancelled";
      intro = "Your cancellation request has been reviewed and approved by our team.";
      detailHtml = `${summaryCard(orderNumberRow)}${reason ? `<p style="color:${MUTED};font-size:14px;line-height:1.6"><strong>Update:</strong> ${escapeHtml(reason)}</p>` : ""}<p style="color:${MUTED};font-size:14px;line-height:1.6">If a refund is due, we’ll send a separate confirmation once it has been completed. This notice does not mean a refund has already been issued.</p>`;
      detailText = `Order number: ${orderNumber}\n${reason ? `Update: ${reason}\n` : ""}If a refund is due, a separate confirmation will be sent once it is complete.\n`;
      break;
    case "ORDER_REFUNDED":
      subject = orderNumber ? `Your Giftij Brandy refund for order ${orderNumber} is complete` : "Your Giftij Brandy refund is complete";
      heading = "Your refund is complete";
      intro = "Our team has confirmed that the refund below has been completed.";
      detailHtml = `${summaryCard(`${orderNumberRow}${payload.refundAmount !== null && payload.refundAmount !== undefined ? `<tr><td style="padding:8px 0;color:${MUTED};font-size:14px">Refund amount</td><td align="right" style="padding:8px 0;color:${INK};font-size:15px;font-weight:600">${escapeHtml(money(payload.refundAmount))}</td></tr>` : ""}`)}${payload.productName ? `<p style="color:${MUTED};font-size:14px">Item: ${escapeHtml(str(payload.productName))} × ${Number(payload.quantityReturned) || 1}</p>` : ""}`;
      detailText = `Order number: ${orderNumber}\n${payload.refundAmount !== null && payload.refundAmount !== undefined ? `Refund amount: ${money(payload.refundAmount)}\n` : ""}${payload.productName ? `Item: ${str(payload.productName)} × ${Number(payload.quantityReturned) || 1}\n` : ""}`;
      break;
  }

  const logo = safeLogoUrl
    ? `<img src="${escapeHtml(safeLogoUrl)}" width="148" alt="Giftij Brandy" style="display:block;width:148px;max-width:100%;height:auto;border:0;margin:0 auto">`
    : `<div style="font-family:Georgia,serif;font-size:27px;letter-spacing:1.4px;color:${INK};font-weight:600">GIFTIJ BRANDY</div>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f4f1;color:${INK};font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f5f4f1;border-collapse:collapse">
    <tr><td align="center" style="padding:28px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#fff;border-collapse:separate;border-spacing:0;border:1px solid #ece9e2;border-radius:10px;overflow:hidden">
        <tr><td align="center" style="padding:28px 24px 22px;background:#fff">
          ${logo}
          <div style="height:2px;width:46px;background:${BRAND_GOLD};margin:18px auto 0"></div>
        </td></tr>
        <tr><td style="padding:26px 30px 12px">
          <p style="margin:0 0 10px;color:#9a8359;font-size:11px;letter-spacing:1.8px;font-weight:700;text-transform:uppercase">A note from Giftij Brandy</p>
          <h1 style="margin:0 0 16px;color:${INK};font-family:Georgia,'Times New Roman',serif;font-size:29px;line-height:1.25;font-weight:600">${escapeHtml(heading)}</h1>
          <p style="margin:0;color:#514e47;font-size:16px;line-height:1.75">Hello ${escapeHtml(customer)},</p>
          <p style="margin:12px 0 0;color:#514e47;font-size:16px;line-height:1.75">${escapeHtml(intro)}</p>
          ${detailHtml}
          ${eventType === "ORDER_COMPLETED" ? "" : `<p style="margin:24px 0 4px;color:#514e47;font-size:15px;line-height:1.7">Thank you for choosing Giftij Brandy. We appreciate your trust in us.</p>`}
          <p style="margin:12px 0 0;color:${INK};font-family:Georgia,'Times New Roman',serif;font-size:16px">Warm regards,<br><strong>Giftij Brandy Team</strong></p>
        </td></tr>
        ${footerHtml(year)}
      </table>
    </td></tr>
  </table>
</body></html>`;

  const plain = `GIFTIJ BRANDY\n\n${heading}\n\nHello ${customer},\n\n${intro}\n\n${detailText}\n${eventType === "ORDER_COMPLETED" ? "" : "Thank you for choosing Giftij Brandy. We appreciate your trust in us.\n\n"}Warm regards,\nGiftij Brandy Team\n\nThis is an automated email address and is not monitored. Please do not reply to this email.\n\nFor enquiries or assistance:\nEmail: ${SUPPORT_EMAIL}\nWhatsApp: ${SUPPORT_WHATSAPP}\n\n© ${year} Giftij Brandy. All rights reserved.\n`;

  return { subject, html, text: plain };
}
