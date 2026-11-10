import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Keep the existing application cache behavior for the first Cloudflare Preview.
// Add a shared cache backend only if the Preview tests confirm ISR/revalidation needs it.
export default defineCloudflareConfig();
