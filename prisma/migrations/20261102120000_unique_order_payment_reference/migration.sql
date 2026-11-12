-- One order per Paystack reference. Null references remain allowed for
-- manually-created orders. Fail safely rather than deleting or merging any
-- historical records if duplicate references already exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Order"
    WHERE "paymentReference" IS NOT NULL
    GROUP BY "paymentReference"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add unique Order.paymentReference index: duplicate non-null references exist. Resolve duplicates before deploying this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_paymentReference_key"
ON "Order"("paymentReference");
