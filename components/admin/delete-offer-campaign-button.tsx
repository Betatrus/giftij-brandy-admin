"use client";

import { deleteOfferCampaign } from "@/lib/actions/offer-campaigns";

export function DeleteOfferCampaignButton({ campaignId, campaignTitle }: { campaignId: string; campaignTitle: string }) {
  return (
    <form
      action={deleteOfferCampaign}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Delete "${campaignTitle}"? This permanently removes the campaign and its Offer Sets. Campaigns with paid orders or active checkout reservations cannot be deleted.`,
        );
        if (!confirmed) event.preventDefault();
      }}
    >
      <input type="hidden" name="campaignId" value={campaignId} />
      <button
        type="submit"
        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
      >
        Delete campaign
      </button>
    </form>
  );
}
