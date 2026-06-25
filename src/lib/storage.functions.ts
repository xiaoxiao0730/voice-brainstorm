import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isSupportedContextMime } from "@/lib/contextFiles";

const CONTEXT_BUCKET = "session-context";
const BRIEF_IMAGE_BUCKET = "brief-images";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 10;
const MAX_CONTEXT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_BRIEF_IMAGE_BYTES = 10 * 1024 * 1024;

function decodeBase64(contentBase64: string): Uint8Array {
  const normalized = contentBase64.includes(",")
    ? contentBase64.slice(contentBase64.indexOf(",") + 1)
    : contentBase64;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(0, 120) || "upload";
}

function imageExtension(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  return "jpg";
}

export const uploadContextFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        name: z.string().min(1).max(300),
        mime: z.string().min(1).max(200).refine(isSupportedContextMime, {
          message: "Supported context files: PDF, images, text, JSON, XML, HTML.",
        }),
        size: z.number().int().nonnegative().max(MAX_CONTEXT_FILE_BYTES),
        contentBase64: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const bytes = decodeBase64(data.contentBase64);
    if (bytes.byteLength !== data.size) {
      throw new Error("Uploaded file size does not match the declared size.");
    }

    const key = `${userId}/${data.sessionId}/${crypto.randomUUID()}-${safeFileName(data.name)}`;
    const { error } = await supabase.storage
      .from(CONTEXT_BUCKET)
      .upload(key, bytes, {
        contentType: data.mime || "application/octet-stream",
        upsert: false,
      });
    if (error) throw new Error(error.message);

    return {
      path: key,
      name: data.name,
      mime: data.mime,
      size: data.size,
    };
  });

export const uploadBriefImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        name: z.string().min(1).max(300).optional(),
        mime: z.string().min(1).max(200).refine((mime) => mime.startsWith("image/"), {
          message: "Only image uploads are supported.",
        }),
        size: z.number().int().nonnegative().max(MAX_BRIEF_IMAGE_BYTES),
        contentBase64: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const bytes = decodeBase64(data.contentBase64);
    if (bytes.byteLength !== data.size) {
      throw new Error("Uploaded image size does not match the declared size.");
    }

    const ext = imageExtension(data.mime);
    const key = `${userId}/${data.sessionId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(BRIEF_IMAGE_BUCKET)
      .upload(key, bytes, {
        contentType: data.mime || "image/jpeg",
        upsert: false,
      });
    if (uploadError) throw new Error(uploadError.message);

    const { data: signed, error: signedError } = await supabase.storage
      .from(BRIEF_IMAGE_BUCKET)
      .createSignedUrl(key, SIGNED_URL_TTL_SECONDS);
    if (signedError || !signed?.signedUrl) {
      throw new Error(signedError?.message || "Could not create signed image URL.");
    }

    return {
      path: key,
      signedUrl: signed.signedUrl,
      mime: data.mime,
      size: data.size,
    };
  });
