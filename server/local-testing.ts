import type { Request } from "express";

const loopbackHost = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]";

export function isLocalTestingRequest(
  req: Pick<Request, "socket" | "headers">,
): boolean {
  const peer = req.socket.remoteAddress;
  if (peer !== "127.0.0.1" && peer !== "::1" && peer !== "::ffff:127.0.0.1")
    return false;
  try {
    // Read the actual Host, not forwarded headers from a reverse proxy.
    if (
      !req.headers.host ||
      !loopbackHost(new URL(`http://${req.headers.host}`).hostname)
    )
      return false;
    return (
      !req.headers.origin || loopbackHost(new URL(req.headers.origin).hostname)
    );
  } catch {
    return false;
  }
}
