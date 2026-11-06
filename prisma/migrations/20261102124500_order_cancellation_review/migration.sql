CREATE TYPE "CancellationReviewStatus" AS ENUM (
  'NONE',
  'REQUESTED',
  'APPROVED',
  'REJECTED'
);

ALTER TABLE "Order"
ADD COLUMN "cancellationReviewStatus" "CancellationReviewStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "cancellationRequestedAt" TIMESTAMP(3),
ADD COLUMN "cancellationRequestedBy" TEXT;
