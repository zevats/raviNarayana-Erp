"use client";

import { isNativeApp, nativePlugins } from "@/lib/native";
import { toast } from "@/components/ui/toast";

/**
 * CSV files for download, in the browser and in the phone app.
 *
 * The phone app (Android WebView) ignores browser download links, which is why "Download CSV" did
 * nothing there: in the app the file is saved by the app itself into Downloads/Ravinarayan. In a
 * browser the file downloads normally. Either way a message says where it went.
 *
 * Files open cleanly in Excel and Google Sheets: UTF-8 with a byte-order mark (so ₹ and names in
 * Hindi show correctly), one heading block, then a table with one header row.
 */

export type Cell = string | number | null | undefined;

/** One cell: quoted when needed; text that a spreadsheet would run as a formula is made plain. */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let str = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : String(value);
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** "2026-11-12" → "12-11-2026" (how dates are read in India and in the app). */
export function csvDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

/** A stored time → "12-11-2026 14:05" in India time. */
export function csvDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("day")}-${v("month")}-${v("year")} ${v("hour")}:${v("minute")}`;
}

/** Whole rupees as a plain number for the spreadsheet (no ₹ sign, no commas, so it can be summed). */
export const csvMoney = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? "" : Math.round(Number(n) * 100) / 100);

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + step)));
  return btoa(bin);
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "ravinarayan.csv";

/** Saves a CSV file and says where it went. Returns true when it was saved. */
export async function downloadCsv(fileName: string, rows: Cell[][]): Promise<boolean> {
  const name = safeName(fileName.endsWith(".csv") ? fileName : `${fileName}.csv`);
  return saveText(name, "﻿" + toCsv(rows));
}

async function saveText(name: string, text: string): Promise<boolean> {
  try {
    if (isNativeApp()) {
      const native = nativePlugins().RnApp;
      if (native?.saveFile) {
        const r = await native.saveFile({ name, mime: "text/csv", base64: base64Utf8(text) });
        toast.ok(`${name} saved in ${r?.where || "Downloads"}`);
        return true;
      }
      if (native?.shareFile) {
        await native.shareFile({ name, mime: "text/csv", base64: base64Utf8(text), text: name });
        return true;
      }
      toast.error("Update the app to download files (Menu → Download the app).");
      return false;
    }
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    // Some browsers start the download after this tick: keep the file alive for a while.
    window.setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 60000);
    toast.ok(`Downloaded ${name}`);
    return true;
  } catch {
    toast.error("The file could not be saved. Please try again.");
    return false;
  }
}

/** A CSV made by the server (already text): saved the same way as the others. */
export async function downloadCsvText(fileName: string, csvText: string): Promise<boolean> {
  const name = safeName(fileName.endsWith(".csv") ? fileName : `${fileName}.csv`);
  const text = csvText.startsWith("﻿") ? csvText : "﻿" + csvText;
  return saveText(name, text);
}
