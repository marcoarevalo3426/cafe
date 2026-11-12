import { apiBase, loadToken, saveToken, nativeHeaders } from "./platform";
let token: string | null = null;
export async function initializeSession() {
  token = await loadToken();
}
export async function setSession(next: string | null) {
  token = next;
  await saveToken(next);
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const r = await fetch(`${apiBase}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...nativeHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await r.json();
  if (!r.ok)
    throw new Error(result.error ?? "Something went wrong. Please try again.");
  return result;
}
export const requestKey = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
