import { friendlyError } from "@/lib/friendlyError";
/**
 * JSON request with plain-language errors for the person using the app: the server's own message
 * when it sends one, otherwise a sentence for the status, and a clear line when there is no
 * internet (instead of "Failed to fetch" or "Request failed (500)").
 */
const STATUS_TEXT: Record<number, string> = {
  400: "Something in the form is not right. Check it and try again.",
  401: "Your session has ended. Please sign in again.",
  403: "You do not have access to this.",
  404: "We could not find that. It may have been removed.",
  409: "This changed in the meantime. Refresh and try again.",
  413: "That is too large to send.",
  429: "Too many tries. Please wait a moment and try again.",
};

export function messageForStatus(status: number): string {
  if (STATUS_TEXT[status]) return STATUS_TEXT[status];
  if (status >= 500) return "The server had a problem. Please try again in a moment.";
  return "Something went wrong. Please try again.";
}

export async function requestJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new Error(typeof navigator !== "undefined" && navigator.onLine === false ? "You are offline. Check your internet and try again." : "Could not reach the server. Check your internet and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const serverMessage = (data as any)?.error;
    throw new Error(typeof serverMessage === "string" && serverMessage.trim() ? friendlyError(serverMessage) : messageForStatus(res.status));
  }
  return data as T;
}

export const postJsonRequest = <T = any>(url: string, body: unknown) =>
  requestJson<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
