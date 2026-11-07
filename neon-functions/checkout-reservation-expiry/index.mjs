import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

function isValidTriggerDelivery(request, body) {
  const invocationId = request.headers.get("x-neon-trigger-invocation-id");
  return Boolean(
    invocationId &&
    body &&
    body.version === 1 &&
    body.invocation_id === invocationId &&
    body.trigger?.type === "schedule"
  );
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Neon strips caller-supplied x-neon-* headers. Matching this header to
    // the signed delivery body is the documented trigger authentication.
    if (!isValidTriggerDelivery(request, body)) {
      return Response.json({ error: "Unauthorized trigger delivery" }, { status: 401 });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Lock a bounded batch. SKIP LOCKED lets concurrent invocations and
      // payment webhooks proceed without waiting on the same reservations.
      const due = await client.query(
        `SELECT id, cart
           FROM "CheckoutReservation"
          WHERE status = 'ACTIVE'
            AND "expiresAt" <= NOW()
          ORDER BY "expiresAt" ASC
          LIMIT 50
          FOR UPDATE SKIP LOCKED`
      );

      let released = 0;
      for (const reservation of due.rows) {
        if (!Array.isArray(reservation.cart) || reservation.cart.length === 0) {
          throw new Error(`Reservation ${reservation.id} has an invalid cart.`);
        }

        for (const line of reservation.cart) {
          const quantity = Number(line?.quantity);
          const productId = line?.productId;
          const variantId = line?.variantId ?? null;

          if (
            typeof productId !== "string" ||
            !Number.isSafeInteger(quantity) ||
            quantity <= 0 ||
            !(variantId === null || typeof variantId === "string")
          ) {
            throw new Error(`Reservation ${reservation.id} has an invalid cart line.`);
          }

          const restored = variantId
            ? await client.query(
                `UPDATE "ProductVariant"
                    SET "reservedStock" = "reservedStock" - $1,
                        "currentStock" = "currentStock" + $1,
                        "updatedAt" = NOW()
                  WHERE id = $2
                    AND "productId" = $3
                    AND "reservedStock" >= $1`,
                [quantity, variantId, productId]
              )
            : await client.query(
                `UPDATE "Inventory"
                    SET "reservedStock" = "reservedStock" - $1,
                        "currentStock" = "currentStock" + $1,
                        "updatedAt" = NOW()
                  WHERE "productId" = $2
                    AND "reservedStock" >= $1`,
                [quantity, productId]
              );

          if (restored.rowCount !== 1) {
            throw new Error(
              `Could not safely restore reservation ${reservation.id} for product ${productId}.`
            );
          }
        }

        const marked = await client.query(
          `UPDATE "CheckoutReservation"
              SET status = 'EXPIRED',
                  "releasedAt" = NOW(),
                  "updatedAt" = NOW()
            WHERE id = $1
              AND status = 'ACTIVE'
              AND "expiresAt" <= NOW()`,
          [reservation.id]
        );

        if (marked.rowCount !== 1) {
          throw new Error(`Reservation ${reservation.id} changed during expiry.`);
        }

        released += 1;
      }

      await client.query("COMMIT");
      return Response.json({
        ok: true,
        checkedAt: new Date().toISOString(),
        scanned: due.rowCount,
        released,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Checkout reservation expiry failed:", error);
      return Response.json({ error: "Reservation expiry failed" }, { status: 500 });
    } finally {
      client.release();
    }
  },
};
