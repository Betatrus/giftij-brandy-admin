import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
    // Cloudinary remains the image CDN; do not introduce a second image service.
    unoptimized: true,
  },
  serverExternalPackages: ["@prisma/client", ".prisma/client", "pg"],
};

initOpenNextCloudflareForDev();
export default nextConfig;
