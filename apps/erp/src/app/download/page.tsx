import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import { Download, ShieldCheck, Smartphone } from "lucide-react";
import { RnLogo } from "@/components/brand/RnLogo";

export const metadata: Metadata = { title: "Get the Android app" };
export const dynamic = "force-dynamic";

type Build = { version: string; versionCode: number; bytes: number; sha256: string; builtAt: string };

function currentBuild(): Build | null {
  for (const dir of [path.join(process.cwd(), "public", "download"), path.join(process.cwd(), "apps", "erp", "public", "download")]) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, "ravinarayan.json"), "utf8"));
    } catch {}
  }
  return null;
}

/** Public page with the Android app download (no sign-in needed). */
export default function DownloadPage() {
  const b = currentBuild();
  return (
    <main className="min-h-[100dvh] bg-[#F4F1EA] text-[#16241B]">
      <header className="px-6 pt-16 pb-24 text-center" style={{ background: "radial-gradient(120% 90% at 50% 0%, #22533A 0%, #173A29 55%, #0F2A1D 100%)" }}>
        <RnLogo size={84} outline className="mx-auto drop-shadow-[0_10px_24px_rgba(0,0,0,0.25)]" />
        <h1 className="mt-4 text-[28px] font-extrabold tracking-[-0.02em] text-white">Ravinarayan for Android</h1>
        <p className="mt-1 text-[14px] font-semibold text-[#D4A24E]">ERP and Delivery, in one app</p>
      </header>
      <section className="-mt-16 px-4 pb-10">
        <div className="mx-auto max-w-[440px] bg-white rounded-[28px] shadow-[0_18px_50px_-20px_rgba(15,42,29,0.35)] p-6 space-y-5">
          {b ? (
            <>
              <a href="/download/ravinarayan.apk" download className="rn-press flex items-center justify-center gap-2 h-14 rounded-full bg-[#173A29] text-white text-[16px] font-bold">
                <Download className="w-5 h-5" /> Download the app
              </a>
              <p className="text-center text-[13px] text-[#5B6B5F]">
                Version {b.version} · {(b.bytes / 1048576).toFixed(1)} MB · Android 8.0 or newer
              </p>
            </>
          ) : (
            <p className="text-center text-[15px] font-semibold">The app will be available here soon.</p>
          )}
          <ol className="space-y-3 text-[14px]">
            {[
              ["Download", "Tap the button above on your Android phone."],
              ["Open the file", "When the download finishes, tap it. If Android asks, allow installing from this source."],
              ["Sign in", "Open Ravinarayan from your app list and sign in with your staff account."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="w-7 h-7 shrink-0 rounded-full bg-[#E8EFE9] text-[#173A29] text-[13px] font-bold flex items-center justify-center">{i + 1}</span>
                <span>
                  <span className="font-bold">{t}.</span> <span className="text-[#5B6B5F]">{d}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="flex items-start gap-2.5 rounded-2xl bg-[#F7F3EC] p-3.5 text-[12px] text-[#5B6B5F]">
            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-[#1F5A3D]" />
            <span>
              Signed by Ravinarayan. Updates install over the existing app with your sign-in kept.
              {b ? <span className="block mt-1 break-all font-mono text-[10.5px] text-[#8A968D]">SHA-256 {b.sha256}</span> : null}
            </span>
          </div>
          <p className="flex items-center justify-center gap-1.5 text-[12px] text-[#8A968D]">
            <Smartphone className="w-3.5 h-3.5" /> For Android phones only
          </p>
        </div>
      </section>
    </main>
  );
}
