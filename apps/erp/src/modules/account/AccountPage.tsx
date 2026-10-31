"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Mail, KeyRound, LogOut, ChevronRight, X, Eye, EyeOff, Check, Smartphone, Monitor, CalendarDays, BadgeCheck, Truck, Banknote, Clock, WifiOff } from "lucide-react";
import type { AuthenticatedUser, MyAccount } from "@/types";
import { ROLE_LABELS } from "@/types";
import { UserAvatar } from "@/components/brand/BrandMark";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { FullPageLoader, useFillHeight } from "@/components/feedback/FullPageLoader";
import { useErpQuery, invalidateErpCache, clearErpCache } from "@/lib/cache/erpDataCache";
import { requestJson, postJsonRequest } from "@/lib/http/requestJson";
import { useSheetDrag } from "@/components/feedback/useSheetDrag";
import { forgetPushToken } from "@/lib/native";

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const longDate = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso));
const dateTime = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(iso));

/** Accent per audience: delivery staff app (orange) or the management portal (forest). */
function theme(role: string) {
  return role === "DELIVERY_PERSON"
    ? { btn: "bg-[#C9501C] hover:bg-[#A9400F] text-white", text: "text-[#B4440F]", tint: "bg-[#FCE9DD] text-[#B4440F]", ring: "focus:ring-[#C9501C]/30 focus:border-[#C9501C]", avatar: "bg-[#C9501C] text-white" }
    : { btn: "bg-[#263B2D] hover:bg-[#1A2E20] text-white", text: "text-[#263B2D]", tint: "bg-[#DCE5D7] text-[#263B2D]", ring: "focus:ring-[#5D7656]/30 focus:border-[#5D7656]", avatar: "bg-[#263B2D] text-white" };
}

const post = <T = any,>(url: string, body: unknown) => postJsonRequest<T>(url, body);

function Row({ icon, label, value, action, onAction }: { icon: React.ReactNode; label: string; value: React.ReactNode; action?: string; onAction?: () => void }) {
  const inner = (
    <>
      <span className="w-10 h-10 rounded-xl bg-[#F4F0E8] text-[#3E4540] flex items-center justify-center shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12px] text-[#6E7F70]">{label}</span>
        <span className="block text-[15px] font-semibold text-[#1F2320] break-words">{value}</span>
      </span>
      {action && (
        <span className="flex items-center gap-1 text-[13px] font-semibold text-[#3E4540] shrink-0">
          {action} <ChevronRight className="w-4 h-4" />
        </span>
      )}
    </>
  );
  return onAction ? (
    <button type="button" onClick={onAction} className="rn-press w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-[#FAF8F5]">
      {inner}
    </button>
  ) : (
    <div className="flex items-center gap-3.5 px-4 py-3.5">{inner}</div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useSheetDrag(onClose, true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="rn-scrim absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} {...drag.bind} style={drag.style} className="rn-sheet relative w-full md:max-w-md max-h-[92dvh] overflow-y-auto bg-[#FBF9F3] rounded-t-[28px] md:rounded-[28px] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-4">
        <div className="md:hidden mx-auto -mt-2 mb-1 h-1 w-10 rounded-full bg-[#DAD3C6]" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[20px] font-extrabold tracking-[-0.01em] text-[#1F2320]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rn-press w-10 h-10 -mr-1 rounded-full bg-[#EFEAE1] flex items-center justify-center">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, type = "text", value, onChange, autoComplete, ring, hint, reveal, inputMode, maxLength }: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  ring: string;
  hint?: string;
  reveal?: boolean;
  inputMode?: "numeric" | "email" | "text";
  maxLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="block text-[13px] font-semibold text-[#3E4540] mb-1.5">{label}</span>
      <span className="relative block">
        <input
          type={reveal ? (show ? "text" : "password") : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          inputMode={inputMode}
          maxLength={maxLength}
          className={`w-full h-12 px-4 ${reveal ? "pr-12" : ""} rounded-xl border border-[#E2DBCE] bg-white text-[15px] outline-none focus:ring-4 ${ring}`}
        />
        {reveal && (
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-1 top-1 w-10 h-10 rounded-lg flex items-center justify-center text-[#6E7F70]">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </span>
      {hint && <span className="block mt-1 text-[12px] text-[#6E7F70]">{hint}</span>}
    </label>
  );
}

/** One 6-digit code box: large, spaced digits; numbers only; the phone offers the code from mail. */
function CodeField({ label, value, onChange, ring }: { label: React.ReactNode; value: string; onChange: (v: string) => void; ring: string }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-semibold text-[#3E4540] mb-1.5">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="••••••"
        className={`w-full h-14 px-4 rounded-xl border border-[#E2DBCE] bg-white text-center font-mono text-[24px] tracking-[0.5em] outline-none focus:ring-4 placeholder:text-[#D4CCBD] ${ring}`}
      />
    </label>
  );
}

function Busy({ busy, idle, label }: { busy: boolean; idle: string; label: string }) {
  return busy ? (
    <span className="inline-flex items-center gap-2">
      <BikeLoader inline tone="light" label={label} /> {label}
    </span>
  ) : (
    <>{idle}</>
  );
}

function ErrorNote({ text }: { text: string | null }) {
  return text ? <p role="alert" className="rounded-xl bg-[#FBE3DD] text-[#9A3423] text-sm px-4 py-3">{text}</p> : null;
}

/** Resend link with its one-minute countdown; calls /api/account/resend for the open request. */
function useResend(requestId: string | null, setError: (e: string | null) => void, onNewId: (id: string) => void) {
  const [wait, setWait] = useState(0);
  const [sending, setSending] = useState(false);
  const [sentAgain, setSentAgain] = useState(false);
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);
  const resend = async () => {
    if (!requestId || wait > 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await post<{ requestId: string }>("/api/account/resend", { requestId });
      onNewId(r.requestId);
      setWait(60);
      setSentAgain(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };
  return { wait, setWait, sending, sentAgain, resend };
}

/** Two-step progress line at the top of a sheet ("1 New password · 2 Email code"). */
function Steps({ step, labels }: { step: 1 | 2; labels: [string, string] | null }) {
  if (!labels) return null;
  return (
    <ol className="flex flex-wrap items-center gap-2 text-[12px] font-semibold" aria-label={`Step ${step} of 2`}>
      {labels.map((l, i) => (
        <li key={l} className={`flex items-center gap-2 ${i + 1 <= step ? "text-[#1F2320]" : "text-[#9AA59B]"}`}>
          {i > 0 && <span className="w-6 h-px bg-[#DAD3C6]" aria-hidden="true" />}
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${i + 1 < step ? "bg-[#2F6B24] text-white" : i + 1 === step ? "bg-[#1F2320] text-white" : "bg-[#EFEAE1]"}`}>
            {i + 1 < step ? <Check className="w-3 h-3" /> : i + 1}
          </span>
          {l}
        </li>
      ))}
    </ol>
  );
}

function PasswordSheet({ me, onClose, onDone, t }: { me: MyAccount; onClose: () => void; onDone: (msg: string) => void; t: ReturnType<typeof theme> }) {
  const [step, setStep] = useState<"details" | "code">("details");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [code, setCode] = useState("");
  const [request, setRequest] = useState<{ requestId: string; sentTo: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = useResend(request?.requestId ?? null, setError, (id) => setRequest((q) => (q ? { ...q, requestId: id } : q)));
  const rules = [
    { ok: next.length >= 12, text: "At least 12 characters" },
    { ok: /[A-Za-z]/.test(next) && /[0-9]/.test(next), text: "Letters and at least one number" },
    { ok: next.length > 0 && !next.toLowerCase().includes(me.username.toLowerCase()), text: "Not your username" },
    { ok: next.length > 0 && next === again, text: "Both new passwords match" },
  ];
  const ready = current.length > 0 && rules.every((x) => x.ok);
  const finished = (n: number) => {
    onDone(n > 0 ? `Password changed. ${n} other ${n === 1 ? "device was" : "devices were"} signed out.` : "Password changed.");
    onClose();
  };
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ requestId: string; sentTo: string }>("/api/account/password/request", { currentPassword: current, newPassword: next });
      setRequest(res);
      setCode("");
      setStep("code");
      r.setWait(60);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!request || code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ otherDevicesSignedOut: number }>("/api/account/password/confirm", { requestId: request.requestId, code, newPassword: next });
      finished(res.otherDevicesSignedOut);
    } catch (e: any) {
      setError(e.message);
      if (/Start again/.test(e.message)) setStep("details");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Change password" onClose={onClose}>
      <Steps step={step === "details" ? 1 : 2} labels={["New password", "Verify OTP"]} />
      <ErrorNote text={error} />
      {step === "details" ? (
        <>
          <Field label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" ring={t.ring} reveal />
          <Field label="New password" value={next} onChange={setNext} autoComplete="new-password" ring={t.ring} reveal />
          <Field label="Type the new password again" value={again} onChange={setAgain} autoComplete="new-password" ring={t.ring} reveal />
          {/* Live checklist: a grey bullet until the rule is met, then a green tick. */}
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl bg-[#F4F0E8] px-3.5 py-3" aria-label="Password rules" aria-live="polite">
            {rules.map((x) => (
              <li key={x.text} className={`flex items-center gap-2 text-[13px] transition-colors ${x.ok ? "text-[#2F6B24] font-semibold" : "text-[#6E7F70]"}`}>
                <span className="w-4 h-4 flex items-center justify-center shrink-0" aria-hidden="true">
                  {x.ok ? <Check className="rn-tick w-4 h-4 text-[#2F6B24]" strokeWidth={3} /> : <span className="w-1.5 h-1.5 rounded-full bg-[#B7AE9F]" />}
                </span>
                <span>
                  {x.text}
                  <span className="sr-only">{x.ok ? " — done" : " — not yet"}</span>
                </span>
              </li>
            ))}
          </ul>
          <button type="button" onClick={submit} disabled={!ready || busy} className={`rn-press w-full h-12 rounded-full font-semibold disabled:opacity-40 ${t.btn}`}>
            <Busy busy={busy} idle="Send OTP" label="Sending OTP…" />
          </button>
        </>
      ) : (
        <>
          <p className="text-[14px] text-[#3E4540]">
            OTP sent to <span className="font-semibold">{request?.sentTo}</span>
          </p>
          <CodeField label="OTP" value={code} onChange={setCode} ring={t.ring} />
          {r.sentAgain && <p className="text-[12px] text-[#2F6B24]">New OTP sent.</p>}
          <button type="button" onClick={confirm} disabled={code.length !== 6 || busy} className={`rn-press w-full h-12 rounded-full font-semibold disabled:opacity-40 ${t.btn}`}>
            <Busy busy={busy} idle="Confirm new password" label="Checking…" />
          </button>
          <div className="flex items-center justify-between text-[13px]">
            <button type="button" onClick={() => setStep("details")} className="font-semibold text-[#3E4540] h-10">
              Back
            </button>
            <button type="button" onClick={r.resend} disabled={r.wait > 0 || r.sending} className={`font-semibold h-10 disabled:text-[#9AA59B] ${t.text}`}>
              {r.sending ? "Sending…" : r.wait > 0 ? `Resend OTP in ${r.wait}s` : "Resend OTP"}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function EmailSheet({ me, onClose, onDone, t }: { me: MyAccount; onClose: () => void; onDone: (msg: string) => void; t: ReturnType<typeof theme> }) {
  const [step, setStep] = useState<"details" | "code">("details");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [currentCode, setCurrentCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [request, setRequest] = useState<{ requestId: string; sentToCurrent: string; sentToNew: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = useResend(request?.requestId ?? null, setError, (id) => setRequest((q) => (q ? { ...q, requestId: id } : q)));
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ requestId: string; sentToCurrent: string; sentToNew: string }>("/api/account/email/request", { newEmail: email.trim(), currentPassword: password });
      setRequest(res);
      setCurrentCode("");
      setNewCode("");
      setStep("code");
      r.setWait(60);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (busy || !request) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ email: string }>("/api/account/email/confirm", { requestId: request.requestId, currentCode, newCode });
      onDone(`Email changed to ${res.email}. Sign-in codes go there from now on.`);
      onClose();
    } catch (e: any) {
      setError(e.message);
      if (/Start again/.test(e.message)) setStep("details");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Change email" onClose={onClose}>
      <Steps step={step === "details" ? 1 : 2} labels={["New email", "Verify OTP"]} />
      <ErrorNote text={error} />
      {step === "details" ? (
        <>
          <p className="text-[14px] text-[#3E4540]">
            Now: <span className="font-semibold">{me.email}</span>
          </p>
          <Field label="New email" type="email" inputMode="email" value={email} onChange={setEmail} autoComplete="email" ring={t.ring} />
          <Field label="Current password" value={password} onChange={setPassword} autoComplete="current-password" ring={t.ring} reveal />
          <button type="button" onClick={send} disabled={!validEmail || !password || busy} className={`rn-press w-full h-12 rounded-full font-semibold disabled:opacity-40 ${t.btn}`}>
            <Busy busy={busy} idle="Send OTP" label="Sending OTP…" />
          </button>
        </>
      ) : (
        <>
          <CodeField
            label={
              <>
                OTP sent to current email <span className="font-normal text-[#6E7F70]">({request?.sentToCurrent})</span>
              </>
            }
            value={currentCode}
            onChange={setCurrentCode}
            ring={t.ring}
          />
          <CodeField
            label={
              <>
                OTP sent to new email <span className="font-normal text-[#6E7F70]">({request?.sentToNew})</span>
              </>
            }
            value={newCode}
            onChange={setNewCode}
            ring={t.ring}
          />
          {r.sentAgain && <p className="text-[12px] text-[#2F6B24]">New OTPs sent.</p>}
          <button type="button" onClick={confirm} disabled={currentCode.length !== 6 || newCode.length !== 6 || busy} className={`rn-press w-full h-12 rounded-full font-semibold disabled:opacity-40 ${t.btn}`}>
            <Busy busy={busy} idle="Confirm new email" label="Checking…" />
          </button>
          <div className="flex items-center justify-between text-[13px]">
            <button type="button" onClick={() => setStep("details")} className="font-semibold text-[#3E4540] h-10">
              Use another email
            </button>
            <button type="button" onClick={r.resend} disabled={r.wait > 0 || r.sending} className={`font-semibold h-10 disabled:text-[#9AA59B] ${t.text}`}>
              {r.sending ? "Sending…" : r.wait > 0 ? `Resend OTP in ${r.wait}s` : "Resend OTP"}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

const deviceIcon = (label: string) => (/Windows|Mac|Linux|Chromebook/.test(label) ? <Monitor className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />);

/** Devices signed in to this account (this one first) and signing the others out. */
function DevicesCard({ me, onDone }: { me: MyAccount; onDone: (msg: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = me.devices.slice(0, 6);
  const signOutOthers = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ signedOut: number }>("/api/account/devices/sign-out", {});
      setConfirming(false);
      onDone(r.signedOut > 0 ? `${r.signedOut} other ${r.signedOut === 1 ? "device was" : "devices were"} signed out.` : "No other device was signed in.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="divide-y divide-[#ECE6DB]">
      {shown.map((d) => (
        <div key={d.id} className="flex items-center gap-3.5 px-4 py-3.5">
          <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${d.current ? "bg-[#DDF1D6] text-[#2F6B24]" : "bg-[#F4F0E8] text-[#3E4540]"}`}>{deviceIcon(d.label)}</span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-semibold text-[#1F2320] truncate">{d.label}</span>
            <span className="block text-[12px] text-[#6E7F70]">{d.current ? "This device" : `Signed in ${dateTime(d.signedInAt)}`}</span>
          </span>
          {d.current && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#DDF1D6] text-[#2F6B24] shrink-0">Active now</span>}
        </div>
      ))}
      {me.devices.length > shown.length && <p className="px-4 py-3 text-[12px] text-[#6E7F70]">and {me.devices.length - shown.length} more</p>}
      {me.otherSessions > 0 && (
        <div className="px-4 py-3.5 space-y-2">
          {error && <p role="alert" className="text-[13px] text-[#9A3423]">{error}</p>}
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] text-[#3E4540] flex-1 min-w-[180px]">
                Sign out {me.otherSessions} other {me.otherSessions === 1 ? "device" : "devices"}?
              </p>
              <button type="button" onClick={() => setConfirming(false)} className="rn-press h-10 px-4 rounded-full bg-[#EFEAE1] text-[13px] font-semibold">
                Cancel
              </button>
              <button type="button" onClick={signOutOthers} disabled={busy} className="rn-press h-10 px-4 rounded-full bg-[#9A3423] text-white text-[13px] font-semibold disabled:opacity-60">
                <Busy busy={busy} idle="Sign out" label="Signing out…" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="rn-press h-11 w-full rounded-full bg-[#FBE3DD] text-[14px] font-bold text-[#9A3423] flex items-center justify-center gap-2 hover:bg-[#F7D3CA] active:bg-[#F2C4B8]">
              <LogOut className="w-4 h-4" /> Sign out other devices
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * My account (all roles): who you are, a short summary of your work, your details, and security
 * (password, email, devices). Every change is checked on the server: current password, and a code
 * sent by email (one to the current address for a password; one to each address for an email).
 */
export function AccountPage({ user }: { user: AuthenticatedUser }) {
  const q = useErpQuery<MyAccount>("/api/account", async () => {
    return requestJson<MyAccount>("/api/account");
  }, { ttl: 30000, tags: ["account", "delivery", "custody"] });
  const [sheet, setSheet] = useState<null | "password" | "email">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const fill = useFillHeight<HTMLDivElement>();
  const t = useMemo(() => theme(user.role), [user.role]);
  const tone = user.role === "DELIVERY_PERSON" ? "orange" : "forest";
  const me = q.data;
  // ?sheet=password|email (from the profile menu) opens that sheet, also when this page is
  // already open: the menu then sends "erp:account-sheet" instead of navigating.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("sheet");
    if (want === "password" || want === "email") {
      setSheet(want);
      window.history.replaceState(window.history.state, "", "/account");
    }
    const onAsk = (e: Event) => {
      const which = (e as CustomEvent<string>).detail;
      if (which === "password" || which === "email") setSheet(which);
    };
    window.addEventListener("erp:account-sheet", onAsk);
    return () => window.removeEventListener("erp:account-sheet", onAsk);
  }, []);

  const done = (msg: string) => {
    setNotice(msg);
    invalidateErpCache(["account"]);
  };
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await forgetPushToken();
      clearErpCache();
      await fetch("/api/auth/logout", { method: "POST", headers: { "X-RN-CSRF": "1" } });
    } finally {
      window.location.replace("/login");
    }
  };

  if (!me) {
    return q.error ? (
      <div ref={fill.ref} style={fill.style} role="alert" className="mx-auto max-w-md min-h-[50vh] flex flex-col items-center justify-center text-center gap-3 px-4">
        <span className="w-14 h-14 rounded-2xl bg-[#FBE3DD] text-[#9A3423] flex items-center justify-center">
          <WifiOff className="w-6 h-6" />
        </span>
        <p className="text-[16px] font-bold">Could not load your account.</p>
        <p className="text-[13px] text-[#5A6C5E]">Check your internet and try again.</p>
        <button
          type="button"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              await q.refetch();
            } finally {
              setRetrying(false);
            }
          }}
          className={`rn-press h-11 px-6 rounded-full font-semibold ${t.btn}`}
        >
          <Busy busy={retrying} idle="Try again" label="Trying again" />
        </button>
      </div>
    ) : (
      <FullPageLoader tone={tone} label="Opening your account…" size="md" />
    );
  }

  const s = me.summary;
  return (
    <div className="mx-auto max-w-[720px] space-y-5 font-sans text-[#1F2320]">
      <h1 className="text-[28px] md:text-[32px] font-extrabold tracking-[-0.02em]">My account</h1>
      {notice && (
        <p role="status" className="rn-enter flex items-center gap-2 rounded-xl bg-[#DDF1D6] text-[#2F6B24] text-sm font-medium px-4 py-3">
          <BadgeCheck className="w-4 h-4 shrink-0" /> {notice}
        </p>
      )}

      <section className="rounded-2xl bg-white border border-[#ECE6DB] p-4 flex items-center gap-4">
        <UserAvatar size={64} tone={tone} />
        <div className="min-w-0">
          <p className="text-[20px] font-extrabold tracking-[-0.01em] truncate">{me.fullName}</p>
          <p className="text-[14px] text-[#5A6C5E]">{me.role === "DELIVERY_PERSON" ? "Delivery Partner" : ROLE_LABELS[me.role] || me.role}</p>
          <p className="text-[12px] text-[#6E7F70]">With us since {longDate(me.memberSince)}</p>
        </div>
      </section>

      {s && (
        <section className="space-y-2.5">
          <h2 className="text-[16px] font-extrabold">{s.monthLabel}</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: <Truck className="w-4 h-4" />, label: "Deliveries", value: String(s.stopsThisMonth), sub: `${s.deliveredThisMonth} delivered in full` },
              { icon: <BadgeCheck className="w-4 h-4" />, label: "Delivered in full", value: s.deliveredRate === null ? "—" : `${s.deliveredRate}%`, sub: "of finished stops" },
              { icon: <Clock className="w-4 h-4" />, label: "Today", value: `${s.todayDone} / ${s.todayStops}`, sub: "stops done" },
              { icon: <Banknote className="w-4 h-4" />, label: "Cash handed over", value: rupees(s.cashHandedOverThisMonth), sub: s.cashWithYou > 0 ? `${rupees(s.cashWithYou)} with you now` : "Nothing with you now" },
            ].map((x) => (
              <div key={x.label} className="rounded-2xl bg-white border border-[#ECE6DB] p-4">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${t.tint}`}>{x.icon}</span>
                <p className="mt-2 text-[22px] font-extrabold leading-tight">{x.value}</p>
                <p className="text-[13px] font-semibold">{x.label}</p>
                <p className="text-[12px] text-[#6E7F70]">{x.sub}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2.5">
        <h2 className="text-[16px] font-extrabold">Personal details</h2>
        <div className="rounded-2xl bg-white border border-[#ECE6DB] divide-y divide-[#ECE6DB] overflow-hidden">
          <Row icon={<Mail className="w-4 h-4" />} label="Email" value={me.email} action="Change" onAction={() => setSheet("email")} />
          <Row icon={<CalendarDays className="w-4 h-4" />} label="Member since" value={longDate(me.memberSince)} />
        </div>
      </section>

      <section className="space-y-2.5">
        <h2 className="text-[16px] font-extrabold">Security</h2>
        <div className="rounded-2xl bg-white border border-[#ECE6DB] divide-y divide-[#ECE6DB] overflow-hidden">
          <Row icon={<KeyRound className="w-4 h-4" />} label="Password" value="••••••••••••" action="Change" onAction={() => setSheet("password")} />
          {me.lastSignIn && <Row icon={<Clock className="w-4 h-4" />} label="Last sign-in" value={dateTime(me.lastSignIn)} />}
        </div>
      </section>

      <section className="space-y-2.5">
        <h2 className="text-[16px] font-extrabold">Devices</h2>
        <div className="rounded-2xl bg-white border border-[#ECE6DB] overflow-hidden">
          <DevicesCard me={me} onDone={done} />
        </div>
      </section>

      <button type="button" onClick={signOut} disabled={signingOut} className="rn-press w-full h-12 rounded-full bg-[#FBE3DD] text-[#9A3423] font-bold flex items-center justify-center gap-2 hover:bg-[#F7D3CA] active:bg-[#F2C4B8] disabled:opacity-70">
        {signingOut ? (
          <>
            <BikeLoader inline tone={tone} label="Signing out" /> Signing out…
          </>
        ) : (
          <>
            <LogOut className="w-4 h-4" /> Sign out
          </>
        )}
      </button>

      {sheet === "password" && <PasswordSheet me={me} t={t} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "email" && <EmailSheet me={me} t={t} onClose={() => setSheet(null)} onDone={done} />}
    </div>
  );
}
