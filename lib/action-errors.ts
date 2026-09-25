import { redirect } from "next/navigation";
import type { ZodError } from "zod";

export function firstValidationError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "The submitted values are invalid.";

  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function redirectWithStatus(
  path: string,
  kind: "error" | "message",
  message: string,
): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}
