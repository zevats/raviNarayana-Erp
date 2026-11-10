"use client";

import { useTimedMessage } from "@/lib/useTimedMessage";
import React, { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, User, Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { RnLogo, type RnBrand } from "@/components/brand/RnLogo";
import { storedBrand, rememberBrand } from "@/lib/brand";

function sanitizeNextUrl(rawUrl: string | null): string {
  if (!rawUrl) return "/dashboard";
  if (
    rawUrl.startsWith("/") &&
    !rawUrl.startsWith("//") &&
    !rawUrl.startsWith("/\\") &&
    !rawUrl.includes(":")
  ) {
    return rawUrl;
  }
  return "/dashboard";
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = sanitizeNextUrl(searchParams.get("next"));
  const resetTokenParam = searchParams.get("token");

  // Step: "LOGIN" | "OTP" | "FORGOT" | "RESET"
  const [step, setStep] = useState<"LOGIN" | "OTP" | "FORGOT" | "RESET">(
    resetTokenParam ? "RESET" : "LOGIN"
  );

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // OTP State
  const [challengeId, setChallengeId] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  // Forgot / Reset Password State
  const [forgotIdentifier, setForgotIdentifier] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [successMessage, setSuccessMessage] = useTimedMessage<string>();

  // Distinct granular loading states to avoid UI race conditions
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [loginPhase, setLoginPhase] = useState<"IDLE" | "SIGNING_IN" | "SENDING_CODE" | "CODE_SENT">("IDLE");
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isResendingOtp, setIsResendingOtp] = useState(false);
  const [isSubmittingForgot, setIsSubmittingForgot] = useState(false);
  const [isSubmittingReset, setIsSubmittingReset] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (resetTokenParam) {
      setStep("RESET");
    }
  }, [resetTokenParam]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // Until hydration the forms cannot be submitted (buttons disabled, which also blocks Enter), so a
  // native submission can never send credentials; method="post" keeps them out of URLs regardless.
  const [hydrated, setHydrated] = useState(false);
  // Edition shown before sign-in: remembered from the last sign-in on this device (visual only).
  const [brand, setBrand] = useState<RnBrand>("standard");
  useEffect(() => {
    setHydrated(true);
    setBrand(storedBrand());
  }, []);

  // One request per intentional submit: state updates are async, so a ref blocks a double Enter/click.
  const inFlight = useRef(false);

  // Handle Step 1: Username/Email + Password
  const handlePrimaryLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (inFlight.current) return;
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanIdentifier = identifier.trim();
    if (!cleanIdentifier || !password) {
      setErrorMessage("Please enter your authorized username or email and password.");
      return;
    }

    inFlight.current = true;
    setIsSubmittingLogin(true);
    setLoginPhase("SIGNING_IN");

    // Progression timer: credential verification -> dispatching email via SMTP
    const phaseTimer = setTimeout(() => {
      setLoginPhase("SENDING_CODE");
    }, 1100);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RN-CSRF": "1",
        },
        body: JSON.stringify({
          identifier: cleanIdentifier,
          password,
        }),
      });

      const data = await response.json().catch(() => ({}));
      clearTimeout(phaseTimer);

      if (!response.ok) {
        inFlight.current = false;
        setLoginPhase("IDLE");
        setErrorMessage(data.error || "Invalid username or password. Please verify your credentials.");
        setIsSubmittingLogin(false);
        return;
      }

      if (data.appearance === "delivery" || data.appearance === "standard") setBrand(data.appearance);
      if (data.status === "OTP_REQUIRED") {
        setLoginPhase("CODE_SENT");
        setChallengeId(data.challengeId);
        setMaskedEmail(data.emailMasked);
        setResendCooldown(60);

        // Show the code field immediately (no artificial transition delay).
        inFlight.current = false;
        setStep("OTP");
        setIsSubmittingLogin(false);
        setLoginPhase("IDLE");
        return;
      }

      // Direct session login fallback if OTP is not required
      setLoginPhase("IDLE");
      router.replace(nextUrl);
    } catch (err) {
      clearTimeout(phaseTimer);
      inFlight.current = false;
      setLoginPhase("IDLE");
      console.error("Login request error:", err);
      setErrorMessage("Unable to connect to the authentication service. Please check your network connection.");
      setIsSubmittingLogin(false);
    }
  };

  // Handle Step 2: OTP Verification
  const handleOtpVerify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanOtp = otp.trim();
    if (!cleanOtp || cleanOtp.length !== 6) {
      setErrorMessage("Please enter the 6-digit verification code sent to your email.");
      return;
    }

    if (inFlight.current) return;
    inFlight.current = true;
    setIsVerifyingOtp(true);

    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RN-CSRF": "1",
        },
        body: JSON.stringify({
          challengeId,
          otp: cleanOtp,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        inFlight.current = false;
        setErrorMessage(data.error || "Invalid verification code. Please check and try again.");
        setIsVerifyingOtp(false);
        return;
      }

      // Verification succeeded: navigate cleanly to destination. inFlight stays set so the
      // consumed code cannot be resubmitted while the next page loads. Delivery staff go straight
      // to their run sheet instead of rendering the dashboard only to be redirected from it.
      rememberBrand(data.user?.role === "DELIVERY_PERSON" ? "delivery" : "standard");
      const landing =
        !searchParams.get("next") && data.user?.role === "DELIVERY_PERSON" ? "/delivery" : nextUrl;
      router.replace(landing);
    } catch (err) {
      console.error("OTP verification error:", err);
      inFlight.current = false;
      setErrorMessage("Unable to verify code. Please check your network connection.");
      setIsVerifyingOtp(false);
    }
  };

  // Handle OTP Resend
  const handleResendOtp = async () => {
    if (resendCooldown > 0 || isResendingOtp || isVerifyingOtp || !challengeId) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsResendingOtp(true);

    try {
      const response = await fetch("/api/auth/otp/resend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RN-CSRF": "1",
        },
        body: JSON.stringify({ challengeId }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setErrorMessage(data.error || "Failed to resend verification code.");
        setIsResendingOtp(false);
        return;
      }

      setChallengeId(data.challengeId);
      if (data.emailMasked) {
        setMaskedEmail(data.emailMasked);
      }
      setResendCooldown(60);
      setSuccessMessage("A fresh verification code has been dispatched to your email.");
      setOtp("");
    } catch (err) {
      console.error("OTP resend error:", err);
      setErrorMessage("Unable to connect to the authentication service. Please check your network connection.");
    } finally {
      setIsResendingOtp(false);
    }
  };

  // Handle Forgot Password Initiation
  const handleForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanId = forgotIdentifier.trim();
    if (!cleanId) {
      setErrorMessage("Please enter your username or registered email address.");
      return;
    }

    setIsSubmittingForgot(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RN-CSRF": "1",
        },
        body: JSON.stringify({ identifier: cleanId }),
      });

      const data = await response.json().catch(() => ({}));
      setIsSubmittingForgot(false);
      setSuccessMessage(
        data.message ||
          "If an account matching that identifier exists, a password reset link has been dispatched."
      );
    } catch (err) {
      console.error("Forgot password error:", err);
      setErrorMessage("Unable to process password reset request. Please check your network connection.");
      setIsSubmittingForgot(false);
    }
  };

  // Handle Reset Password Completion
  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!newPassword || newPassword.length < 12) {
      setErrorMessage("New password must be at least 12 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage("Passwords do not match. Please re-enter.");
      return;
    }

    setIsSubmittingReset(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RN-CSRF": "1",
        },
        body: JSON.stringify({
          token: resetTokenParam,
          newPassword,
        }),
      });

      const data = await response.json().catch(() => ({}));
      setIsSubmittingReset(false);

      if (!response.ok) {
        setErrorMessage(data.error || "Unable to reset password. The link may have expired.");
        return;
      }

      setSuccessMessage("Password reset successfully! You can now log in with your new password.");
      setStep("LOGIN");
      setPassword("");
    } catch (err) {
      console.error("Reset password error:", err);
      setErrorMessage("Unable to reset password. Please check your network connection.");
      setIsSubmittingReset(false);
    }
  };

  const t = BRAND_UI[brand];
  const titles: Record<typeof step, string> = { LOGIN: "Sign in", OTP: "Verify it’s you", FORGOT: "Reset your password", RESET: "Set a new password" };

  // The ERP (green) edition uses the ERP's own look: text brand mark over the soft canvas and one
  // glass card. The delivery (orange) edition keeps its app's layout unchanged.
  const erp = brand !== "delivery";
  return (
    <div className={`min-h-[100dvh] w-full flex flex-col ${erp ? "rn-login sm:justify-center" : ""}`} style={erp ? undefined : { background: t.page }}>
      {erp ? (
        <header className="px-6 pt-[max(3rem,calc(env(safe-area-inset-top)+2rem))] sm:pt-0 pb-7 text-center">
          <div className="rn-logo-in inline-block mb-3">
            <RnLogo brand="standard" size={72} title="" className="shadow-[0_12px_30px_-12px_rgba(26,46,32,0.35)]" />
          </div>
          <p className="rn-login-mark">Ravinarayan</p>
          <p className="rn-login-sub">PG &amp; Tiffin ERP</p>
        </header>
      ) : (
      <header className="relative px-6 pt-[max(3.5rem,calc(env(safe-area-inset-top)+2.5rem))] pb-24 sm:pb-28 text-center overflow-hidden" style={{ background: t.hero }}>
        <div aria-hidden="true" className="absolute -right-16 -top-16 w-64 h-64 rounded-full opacity-[0.07] bg-white" />
        <div aria-hidden="true" className="absolute -left-20 bottom-0 w-56 h-56 rounded-full opacity-[0.05] bg-white" />
        <div className="relative rn-logo-in inline-block">
          <RnLogo brand={brand} size={76} outline className="drop-shadow-[0_10px_24px_rgba(0,0,0,0.25)]" />
        </div>
        <p className="relative mt-4 text-[28px] font-extrabold tracking-[-0.02em] text-white">Ravinarayan</p>
        <p className="relative mt-0.5 text-[13px] font-semibold tracking-[0.18em] uppercase" style={{ color: t.caption }}>
          {brand === "delivery" ? "Delivery" : "ERP"}
        </p>
      </header>
      )}

      {/* Form card */}
      <section className={erp ? "px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:flex-none flex-1" : "relative -mt-16 sm:-mt-20 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex-1"}>
        <div className={erp ? "rn-login-card mx-auto w-full max-w-[420px] px-5 sm:px-8 pt-7 pb-8" : "mx-auto w-full max-w-[420px] bg-white rounded-[28px] shadow-[0_18px_50px_-20px_rgba(15,42,29,0.35)] px-5 sm:px-7 pt-6 pb-7"}>
          <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-[#16241B]">{titles[step]}</h1>
          {step === "OTP" && (
            <p className="mt-1 text-[14px] text-[#5B6B5F]">
              Code sent to <span className="font-semibold text-[#16241B]">{maskedEmail || "your email"}</span>
            </p>
          )}
          {step === "FORGOT" && <p className="mt-1 text-[14px] text-[#5B6B5F]">We’ll email you a link to set a new one.</p>}

          {errorMessage && (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-[#FDECE8] text-[#93301F] text-[13px] font-medium px-3.5 py-3">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {errorMessage}
            </p>
          )}
          {successMessage && (
            <p role="status" className="mt-4 flex items-start gap-2 rounded-xl bg-[#E7F4EA] text-[#1D5A2C] text-[13px] font-medium px-3.5 py-3">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> {successMessage}
            </p>
          )}

          {step === "LOGIN" && (
            <form method="post" onSubmit={handlePrimaryLogin} className="mt-5 space-y-4" noValidate>
              <Field id="identifier" label="Username or email" icon={<User className="w-[18px] h-[18px]" />} t={t}>
                <input
                  id="identifier"
                  name="identifier"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  disabled={isSubmittingLogin}
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  className={INPUT}
                />
              </Field>
              <Field
                id="password"
                label="Password"
                icon={<Lock className="w-[18px] h-[18px]" />}
                t={t}
                aside={
                  <button
                    type="button"
                    onClick={() => {
                      setStep("FORGOT");
                      setErrorMessage(null);
                      setSuccessMessage(null);
                    }}
                    className="text-[13px] font-semibold"
                    style={{ color: t.link }}
                  >
                    Forgot?
                  </button>
                }
                trailing={
                  <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"} className="w-11 h-11 flex items-center justify-center text-[#6B7A6F]">
                    {showPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
                  </button>
                }
              >
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  disabled={isSubmittingLogin}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  className={`${INPUT} pr-12`}
                />
              </Field>
              <PrimaryButton t={t} disabled={!hydrated || isSubmittingLogin} busy={isSubmittingLogin} busyLabel="Signing in…">
                Continue
              </PrimaryButton>
            </form>
          )}

          {step === "OTP" && (
            <form method="post" onSubmit={handleOtpVerify} className="mt-5 space-y-4" noValidate>
              <label htmlFor="otp" className="sr-only">
                6-digit code
              </label>
              <input
                id="otp"
                name="otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                required
                autoFocus
                disabled={isVerifyingOtp || isResendingOtp}
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value.replace(/\D/g, ""));
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="••••••"
                className="w-full h-16 rounded-2xl border border-[#DCD5C6] bg-[#FBFAF6] text-center font-mono text-[28px] font-bold tracking-[0.55em] text-[#16241B] placeholder:text-[#CFC7B6] outline-none transition-shadow focus:bg-white"
                style={{ boxShadow: "none" }}
                onFocus={(e) => (e.currentTarget.style.boxShadow = `0 0 0 4px ${t.ring}`)}
                onBlur={(e) => (e.currentTarget.style.boxShadow = "none")}
              />
              <PrimaryButton t={t} disabled={!hydrated || isVerifyingOtp || isResendingOtp || otp.length !== 6} busy={isVerifyingOtp} busyLabel="Verifying…">
                Verify and sign in
              </PrimaryButton>
              <div className="flex items-center justify-between text-[13px] font-semibold pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setStep("LOGIN");
                    setOtp("");
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className="h-10 text-[#5B6B5F]"
                >
                  Use another account
                </button>
                <button type="button" onClick={handleResendOtp} disabled={resendCooldown > 0 || isResendingOtp || isVerifyingOtp} className="h-10 disabled:text-[#9AA59B]" style={resendCooldown > 0 || isResendingOtp ? undefined : { color: t.link }}>
                  {isResendingOtp ? "Sending…" : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}

          {step === "FORGOT" && (
            <form method="post" onSubmit={handleForgotPassword} className="mt-5 space-y-4" noValidate>
              <Field id="forgotIdentifier" label="Username or email" icon={<User className="w-[18px] h-[18px]" />} t={t}>
                <input
                  id="forgotIdentifier"
                  type="text"
                  autoCapitalize="none"
                  required
                  autoFocus
                  disabled={isSubmittingForgot}
                  value={forgotIdentifier}
                  onChange={(e) => {
                    setForgotIdentifier(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  className={INPUT}
                />
              </Field>
              <PrimaryButton t={t} disabled={!hydrated || isSubmittingForgot} busy={isSubmittingForgot} busyLabel="Sending…">
                Send reset link
              </PrimaryButton>
              <BackLink
                onClick={() => {
                  setStep("LOGIN");
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
              />
            </form>
          )}

          {step === "RESET" && (
            <form method="post" onSubmit={handleResetPassword} className="mt-5 space-y-4" noValidate>
              <Field
                id="newPassword"
                label="New password"
                icon={<Lock className="w-[18px] h-[18px]" />}
                t={t}
                trailing={
                  <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} aria-label={showNewPassword ? "Hide password" : "Show password"} className="w-11 h-11 flex items-center justify-center text-[#6B7A6F]">
                    {showNewPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
                  </button>
                }
              >
                <input
                  id="newPassword"
                  type={showNewPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  disabled={isSubmittingReset}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="At least 12 characters"
                  className={`${INPUT} pr-12`}
                />
              </Field>
              <Field id="confirmPassword" label="Type it again" icon={<Lock className="w-[18px] h-[18px]" />} t={t}>
                <input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  disabled={isSubmittingReset}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  className={INPUT}
                />
              </Field>
              <PrimaryButton t={t} disabled={!hydrated || isSubmittingReset} busy={isSubmittingReset} busyLabel="Saving…">
                Save new password
              </PrimaryButton>
              <BackLink
                onClick={() => {
                  setStep("LOGIN");
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
              />
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

const INPUT =
  "w-full min-w-0 h-12 pl-11 pr-4 rounded-xl bg-transparent text-[15px] font-medium text-[#16241B] placeholder:text-[#A5AD9F] outline-none disabled:opacity-60";

type BrandUi = { page: string; hero: string; caption: string; button: string; buttonHover: string; link: string; ring: string; focus: string };
const BRAND_UI: Record<RnBrand, BrandUi> = {
  standard: {
    page: "#F4F1EA",
    hero: "radial-gradient(120% 90% at 50% 0%, #22533A 0%, #173A29 55%, #0F2A1D 100%)",
    caption: "#D4A24E",
    button: "#173A29",
    buttonHover: "#0F2A1D",
    link: "#1F5A3D",
    ring: "rgba(31,90,61,0.18)",
    focus: "#1F5A3D",
  },
  delivery: {
    page: "#FAF3EC",
    hero: "radial-gradient(120% 90% at 50% 0%, #E2662E 0%, #C9501C 55%, #A9400F 100%)",
    caption: "#FFE3C2",
    button: "#C9501C",
    buttonHover: "#A9400F",
    link: "#B4440F",
    ring: "rgba(201,80,28,0.18)",
    focus: "#C9501C",
  },
};

function Field({ id, label, icon, t, aside, trailing, children }: { id: string; label: string; icon: React.ReactNode; t: BrandUi; aside?: React.ReactNode; trailing?: React.ReactNode; children: React.ReactNode }) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={id} className="text-[13px] font-semibold text-[#2B3A30]">
          {label}
        </label>
        {aside}
      </div>
      <div
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={() => setFocused(false)}
        className="relative rounded-xl border bg-[#FBFAF6] transition-all"
        style={{ borderColor: focused ? t.focus : "#DCD5C6", boxShadow: focused ? `0 0 0 4px ${t.ring}` : "none", background: focused ? "#FFFFFF" : "#FBFAF6" }}
      >
        <span className="absolute inset-y-0 left-0 w-11 flex items-center justify-center text-[#7A887D] pointer-events-none">{icon}</span>
        {children}
        {trailing && <span className="absolute inset-y-0 right-0.5 flex items-center">{trailing}</span>}
      </div>
    </div>
  );
}

function PrimaryButton({ t, disabled, busy, busyLabel, children }: { t: BrandUi; disabled: boolean; busy: boolean; busyLabel: string; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="rn-press w-full h-12 rounded-full text-white text-[15px] font-bold inline-flex items-center justify-center gap-2 shadow-[0_8px_20px_-8px_rgba(0,0,0,0.35)] transition-colors disabled:opacity-60 disabled:shadow-none"
      style={{ background: t.button }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.background = t.buttonHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = t.button)}
    >
      {busy ? (
        <>
          <BikeLoader inline tone="light" label={busyLabel} /> {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full h-10 text-[13px] font-semibold text-[#5B6B5F]">
      Back to sign in
    </button>
  );
}
