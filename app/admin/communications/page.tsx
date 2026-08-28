import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmailComposer } from "@/components/admin/communications/email-composer";

export default function CommunicationsPage() {
  return (
    <div>
      <Breadcrumbs items={[{ label: "Home", href: "/admin/dashboard" }, { label: "Communications" }]} />
      <h1 className="font-display text-2xl text-ink mb-1">Communications</h1>
      <p className="font-body text-sm text-ink/50 mb-6">
        Search customers, select one or many, and send a personalized email.
      </p>
      <EmailComposer />
    </div>
  );
}
