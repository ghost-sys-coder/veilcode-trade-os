export function safeInternalRedirect(value: FormDataEntryValue | string | null | undefined, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const url = new URL(value, "http://trade-os.local");
    return url.origin === "http://trade-os.local" ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export function safePostAuthRedirect(value: FormDataEntryValue | string | null | undefined, fallback = "/dashboard"): string {
  const destination = safeInternalRedirect(value, fallback);
  const pathname = new URL(destination, "http://trade-os.local").pathname;
  return pathname === "/login" || pathname.startsWith("/auth/") ? fallback : destination;
}
