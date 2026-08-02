import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export async function uploadImage(fileBase64: string, folder = "giftij-brandy/products") {
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

export async function deleteImage(cloudinaryId: string) {
  return cloudinary.uploader.destroy(cloudinaryId);
}

export default cloudinary;
