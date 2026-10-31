/**
 * Plain device name from a browser user-agent string, e.g. "Chrome on Android" or
 * "Safari on iPhone", for the account's device list and the security emails.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent || "";
  if (!ua) return "Unknown device";

  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /CrOS/.test(ua)
          ? "Chromebook"
          : /Windows/.test(ua)
            ? "Windows"
            : /Mac OS X|Macintosh/.test(ua)
              ? "Mac"
              : /Linux/.test(ua)
                ? "Linux"
                : null;

  const browser = /EdgA?\/|Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser\//.test(ua)
        ? "Samsung Internet"
        : /FxiOS\/|Firefox\//.test(ua)
          ? "Firefox"
          : /CriOS\/|Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;

  if (browser && os) return `${browser} on ${os}`;
  return browser || os || "Unknown device";
}
