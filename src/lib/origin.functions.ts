import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/** Resolve share assets against the serving site, without fixing a deployment host. */
export const getRequestOrigin = createServerFn({ method: "GET" }).handler(() => {
  const request = getRequest();
  const url = new URL(request.url);
  // Only the sandbox's localhost proxy sanitizes this forwarded header.
  const sandboxHost = url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
  return sandboxHost ? `https://${sandboxHost}` : url.origin;
});