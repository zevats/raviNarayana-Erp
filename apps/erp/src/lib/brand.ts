import type { RnBrand } from "@/components/brand/RnLogo";

/**
 * Which edition of the app this device shows before sign-in (green ERP or orange delivery app).
 * Only a visual preference remembered from the last sign-in; access is always decided on the
 * server from the signed-in account's role. In the Android app it is also handed to the native
 * side so the next launch's splash screen uses the same edition.
 */
const KEY = "rn-brand";

export function storedBrand(): RnBrand {
  try {
    return window.localStorage.getItem(KEY) === "delivery" ? "delivery" : "standard";
  } catch {
    return "standard";
  }
}

export function rememberBrand(brand: RnBrand): void {
  try {
    window.localStorage.setItem(KEY, brand);
  } catch {}
  const native = (window as any).Capacitor?.Plugins?.RnApp;
  if (native?.setBrand) native.setBrand({ brand }).catch(() => {});
}
