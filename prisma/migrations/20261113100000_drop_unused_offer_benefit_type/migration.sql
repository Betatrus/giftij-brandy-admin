-- OfferBenefitType was created by the original offer-campaign migration but is not used by the Prisma schema or application.
-- Drop it in a separate migration so the already-applied campaign migration remains immutable.
DROP TYPE IF EXISTS "OfferBenefitType";
