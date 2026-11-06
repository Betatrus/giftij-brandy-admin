import { z } from "zod";

export const createStaffSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["SUPER_ADMIN", "TECHNICAL_SUPPORT", "SUPPORT_ADMIN"]),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>;
