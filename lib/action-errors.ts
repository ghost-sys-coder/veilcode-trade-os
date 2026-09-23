import { redirect } from "next/navigation";
import type { ZodError } from "zod";

export function firstValidationError(error: ZodError): string {
  return error.issues[0]?.message ?? "The submitted values are invalid.";
}

export function redirectWithStatus(
  path: string,
  kind: "error" | "message",
  message: string,
): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}
