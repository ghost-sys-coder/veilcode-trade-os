import { z } from "zod";

/** Public configuration only; shared by app downloads and the native adapter. */
export const localMcpConfigSchema = z.object({
  version: z.literal(1), profile: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  resource: z.string().url(), issuer: z.string().url(), clientId: z.string().uuid(),
  redirectUri: z.string().url(), allowLoopback: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  for (const name of ["resource", "issuer"] as const) {
    const url = new URL(value[name]);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(value.allowLoopback && local && url.protocol === "http:")) ||
      url.pathname !== (name === "resource" ? "/mcp" : "/auth/v1"))
      ctx.addIssue({ code: "custom", path: [name], message: "Invalid trusted integration URL" });
  }
  const redirect = new URL(value.redirectUri);
  if (redirect.protocol !== "http:" || redirect.hostname !== "127.0.0.1" || !redirect.port ||
    Number(redirect.port) < 1024 || redirect.username || redirect.password || redirect.search || redirect.hash ||
    redirect.pathname !== "/callback")
    ctx.addIssue({ code: "custom", path: ["redirectUri"], message: "An explicit loopback callback port is required" });
});
