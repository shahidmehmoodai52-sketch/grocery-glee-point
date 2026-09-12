import { z } from "zod";

/**
 * Shared runtime validators for server functions.
 *
 * These replace type-only `.inputValidator((d: T) => d)` casts so malformed or
 * oversized payloads are rejected before they reach Supabase / the Auth Admin API.
 * Shapes are identical to the previous TypeScript types, so callers are unaffected.
 */

export const uuidSchema = z.string().uuid("Invalid id");
export const emailSchema = z.string().trim().min(3).max(255).email("Invalid email address");
export const passwordSchema = z.string().min(6, "Password must be 6+ chars").max(200);
export const usernameSchema = z.string().trim().min(2, "Username is too short").max(64);
export const staffRoleSchema = z.enum(["admin", "cashier"]);
/** Permission keys are short slugs like `sales.view` — never free-form text. */
export const permsSchema = z
  .array(z.string().trim().regex(/^[a-z0-9_.:-]{2,64}$/i, "Invalid permission key"))
  .max(200)
  .default([]);

export const resetTenantOwnerPasswordInput = z.object({
  tenant_id: uuidSchema,
  new_password: passwordSchema,
});

export const nameSchema = z.string().trim().min(1, "Name is required").max(100);

export const createStaffInput = z.object({
  email: emailSchema,
  password: passwordSchema,
  role: staffRoleSchema,
  perms: permsSchema,
  name: nameSchema,
});

export const createShopStaffInput = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: staffRoleSchema,
  perms: permsSchema,
});

export const resetPasswordInput = z.object({
  user_id: uuidSchema,
  password: passwordSchema,
});

export const setStaffAccessInput = z.object({
  user_id: uuidSchema,
  role: staffRoleSchema,
  perms: permsSchema,
  name: nameSchema,
});

export const userIdInput = z.object({ user_id: uuidSchema });

export const addAdminStaffInput = z.object({ email: emailSchema, perms: permsSchema });

export const setAdminStaffPermsInput = z.object({ user_id: uuidSchema, perms: permsSchema });

/** Compressed data: URL images (one per page), capped well under typical serverless body limits. */
export const extractPurchaseBillInput = z.object({
  images: z
    .array(z.string().startsWith("data:image/", "Expected an image data URL").max(8_000_000, "Image is too large"))
    .min(1, "At least one page is required")
    .max(8, "Up to 8 pages per bill"),
  // Pharmacy tenants only — asks the extractor to also read batch numbers
  // and expiry dates off the bill. Omitted/false leaves the prompt and
  // schema byte-identical to before for every other caller.
  extractBatchExpiry: z.boolean().optional(),
});

/** Turns zod issues into a single user-friendly message. */
export function parseInput<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid input");
  }
  return result.data;
}
