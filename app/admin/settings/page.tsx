import { auth } from "@/auth";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { getCustomerCareWhatsApp } from "@/lib/config/customer-care";
import { ChangePasswordForm } from "@/components/admin/settings/change-password-form";
import { CustomerCareWhatsAppForm } from "@/components/admin/settings/customer-care-whatsapp-form";
import { BlogVisibilityForm } from "@/components/admin/settings/blog-visibility-form";
import { getStoreSettings } from "@/lib/actions/settings";

export default async function SettingsPage() {
  const session = await auth();
  const isSuperAdmin = session?.user?.role === "SUPER_ADMIN";
  const whatsapp = isSuperAdmin ? await getCustomerCareWhatsApp() : null;
  const storeSettings = isSuperAdmin ? await getStoreSettings() : null;

  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", href: "/admin/dashboard" }, { label: "Settings" }]} />
      <h1 className="font-display text-2xl text-ink mb-1">Settings</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        Only what actually works is shown here — nothing below is a placeholder.
      </p>

      <div className="space-y-6 max-w-2xl">
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
          <h2 className="font-body text-sm font-medium text-ink mb-1">Your Password</h2>
          <p className="font-body text-xs text-ink/50 mb-4">Change the password you use to sign in.</p>
          <ChangePasswordForm />
        </section>

        {isSuperAdmin && (
          <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
            <h2 className="font-body text-sm font-medium text-ink mb-2">Customer Care WhatsApp</h2>
            <p className="font-body text-xs text-ink/50 mb-3">
              Shown to customers when something they want is low or out of stock.
            </p>
            <CustomerCareWhatsAppForm initialNumber={whatsapp} />
          </section>
        )}

        {isSuperAdmin && storeSettings && (
          <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
            <h2 className="font-body text-sm font-medium text-ink mb-2">Blog visibility & search indexing</h2>
            <p className="font-body text-xs text-ink/50 mb-4">Control storefront navigation and whether eligible published articles can be indexed.</p>
            <BlogVisibilityForm navigationVisible={storeSettings.blogNavigationVisible} indexingEnabled={storeSettings.blogIndexingEnabled} />
          </section>
        )}

        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6 opacity-60">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-body text-sm font-medium text-ink">Notifications</h2>
            <span className="font-body text-xs text-ink/40 bg-cream rounded-full px-2.5 py-1">Not available yet</span>
          </div>
          <p className="font-body text-xs text-ink/50">
            Get alerts when customers place orders, payments are received, or important order
            updates occur — coming in a future update.
          </p>
        </section>

        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6 opacity-60">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-body text-sm font-medium text-ink">Dark Mode</h2>
            <span className="font-body text-xs text-ink/40 bg-cream rounded-full px-2.5 py-1">Not available yet</span>
          </div>
          <p className="font-body text-xs text-ink/50">
            A dark theme for the admin isn't ready to turn on safely yet — it needs more work
            behind the scenes first, coming in a future update.
          </p>
        </section>

        {isSuperAdmin && (
          <>
            <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6 opacity-60">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-body text-sm font-medium text-ink">Store Branding</h2>
                <span className="font-body text-xs text-ink/40 bg-cream rounded-full px-2.5 py-1">Not available yet</span>
              </div>
              <p className="font-body text-xs text-ink/50">
                Store name, logo, and colours will be configurable here in a future update.
              </p>
            </section>

            <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6 opacity-60">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-body text-sm font-medium text-ink">Payments</h2>
                <span className="font-body text-xs text-ink/40 bg-cream rounded-full px-2.5 py-1">Not available yet</span>
              </div>
              <p className="font-body text-xs text-ink/50">
                Payment details are currently set up by whoever manages the store's technical
                setup, not from this page.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
