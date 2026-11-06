-- Separate operational refund status from restricted monetary refund amount.
CREATE TYPE "CustomerRefundStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'COMPLETED');

ALTER TABLE "CustomerReturn"
ADD COLUMN "refundStatus" "CustomerRefundStatus" NOT NULL DEFAULT 'NOT_REQUIRED';
