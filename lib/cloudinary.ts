import { v2 as cloudinary } from "cloudinary";

export const PRODUCT_MEDIA_FOLDER = "giftij-brandy/products";\nexport const BLOG_MEDIA_FOLDER = "giftij-brandy/blog";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

function requireCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary is not fully configured on the server.");
  }

  return { cloudName, apiKey, apiSecret };
}

/**
 * Legacy server-side uploader kept for backwards compatibility with any
 * older callers. New admin product uploads use a signed direct browser upload
 * so image bytes no longer travel through a Next.js Server Action.
 */
export async function uploadImage(
  fileBase64: string,
  folder = PRODUCT_MEDIA_FOLDER
) {
  const result = await cloudinary.uploader.upload(fileBase64, {
    folder,
    resource_type: "image",
  });

  return {
    url: result.secure_url,
    cloudinaryId: result.public_id,
    width: result.width as number | undefined,
    height: result.height as number | undefined,
    format: result.format as string | undefined,
  };
}

export function createSignedProductUpload() {
  const { cloudName, apiKey, apiSecret } = requireCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = PRODUCT_MEDIA_FOLDER;

  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder },
    apiSecret
  );

  return {
    cloudName,
    apiKey,
    timestamp,
    folder,
    signature,
  };
}

export async function getImageResource(cloudinaryId: string) {
  const result = await cloudinary.api.resource(cloudinaryId, {
    resource_type: "image",
  });

  return {
    url: result.secure_url as string,
    cloudinaryId: result.public_id as string,
    width: result.width as number | undefined,
    height: result.height as number | undefined,
    format: result.format as string | undefined,
  };
}

export function isProductMediaCloudinaryId(cloudinaryId: string) {
  return cloudinaryId.startsWith(`${PRODUCT_MEDIA_FOLDER}/`);
}

export async function deleteImage(cloudinaryId: string) {
  return cloudinary.uploader.destroy(cloudinaryId, {
    resource_type: "image",
    invalidate: true,
  });
}

export default cloudinary;

export function createSignedBlogUpload() {
  const { cloudName, apiKey, apiSecret } = requireCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = BLOG_MEDIA_FOLDER;
  const signature = cloudinary.utils.api_sign_request({ timestamp, folder }, apiSecret);
  return { cloudName, apiKey, timestamp, folder, signature };
}
export function isBlogMediaCloudinaryId(cloudinaryId: string) {
  return cloudinaryId.startsWith(`${BLOG_MEDIA_FOLDER}/`);
}
