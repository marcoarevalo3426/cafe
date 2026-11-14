export function normalizeBasePath(value: string | undefined) {
  const path = (value ?? "").replace(/\/+$/, "");
  if (!path || path === "/") return "";
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(path))
    throw new Error(
      "APP_BASE_PATH must be an absolute URL path such as /cafe.",
    );
  return path;
}
