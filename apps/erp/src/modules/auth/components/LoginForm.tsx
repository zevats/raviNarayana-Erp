"use client";

import { useTimedMessage } from "@/lib/useTimedMessage";
import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Lock, User, Eye, EyeOff, AlertCircle, CheckCircle2, ArrowRight, BedDouble, DoorOpen, UtensilsCrossed, ReceiptText, MapPin, Wallet, HandCoins, QrCode } from "lucide-react";
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

  // The sign-in page fills the window without page scrolling (html[data-rn-login] in glass.css).
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-rn-login", "");
    return () => document.documentElement.removeAttribute("data-rn-login");
  }, []);

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
  // Code accepted: the form melts away into a greeting while the app loads, then the page blends
  // into the app (the logo and brand panel glide into the app's bar; see "Sign-in blend" in glass.css).
  const [entering, setEntering] = useState(false);
  // Signed in: a full page load of the app (never an in-app jump that could reuse a page answer
  // from before the session existed, which sent people back to the password step).
  const openApp = (href: string) => {
    const target = href.startsWith("/") ? href : "/dashboard";
    try {
      // Read by the app's first paint: it plays the arrival (ErpShell).
      if (!target.startsWith("/delivery")) sessionStorage.setItem("rn-arrive", String(Date.now()));
    } catch {}
    window.location.replace(target);
  };
  const otpFormRef = useRef<HTMLFormElement | null>(null);
  const autoSent = useRef("");
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
  // Before the first paint (layout effect), so a delivery phone never flashes the other edition.
  useLayoutEffect(() => {
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
      setEntering(true);
      openApp(nextUrl);
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
      setEntering(true);
      const landing =
        !searchParams.get("next") && data.user?.role === "DELIVERY_PERSON" ? "/delivery" : nextUrl;
      openApp(landing);
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

  // Wake the server and the database while the person types (a sleeping database adds seconds to
  // the first sign-in request). Nothing about the app is preloaded here: before the code is
  // accepted there is no session, and a preloaded page would only be a redirect back to sign-in.
  useEffect(() => {
    fetch("/api/health", { cache: "no-store" }).catch(() => undefined);
  }, []);
  // The sixth digit sends the code (once per code; a wrong code is not resent by itself).
  useEffect(() => {
    if (step !== "OTP" || otp.length !== 6 || isVerifyingOtp || autoSent.current === otp) return;
    autoSent.current = otp;
    otpFormRef.current?.requestSubmit();
  }, [otp, step, isVerifyingOtp]);

  const t = BRAND_UI[brand];
  const titles: Record<typeof step, string> = { LOGIN: "Sign in", OTP: "Verify it’s you", FORGOT: "Reset your password", RESET: "Set a new password" };

  // The ERP (green) edition uses the ERP's own look: text brand mark over the soft canvas and one
  // glass card. The delivery (orange) edition keeps its app's layout unchanged.
  const erp = brand !== "delivery";
  return (
    <div className={`min-h-[100dvh] w-full flex flex-col lg:h-[100dvh] lg:overflow-hidden ${erp ? "rn-login justify-center" : ""}`} style={erp ? undefined : { background: t.page }} data-leaving={entering ? "" : undefined}>
      {/* Same-site page loads from here blend into the next page (browsers with View Transitions). */}
      <style>{"@view-transition { navigation: auto; }"}</style>
      {entering && <div className="rn-login-progress" role="status" aria-label="Signing in" />}
      <div className="w-full flex flex-col lg:flex-row lg:h-full rn-login-shell">
      {/* Large screens: the brand panel (sidebar glass, the PG photo, the logo and name). */}
      <aside className={`rn-login-brand hidden lg:flex ${erp ? "" : "rn-login-brand-delivery"}`} aria-hidden="true">
        <svg className="rn-login-lines" viewBox="0 0 600 760" preserveAspectRatio="xMidYMid slice" fill="none">
          <circle cx="470" cy="250" r="230" />
          <circle cx="470" cy="250" r="150" />
          <circle cx="90" cy="690" r="190" />
          <path d="M-20 180 L300 -40 L640 220 L420 560 L60 470 Z" />
          <path d="M300 -40 L420 560 M-20 180 L640 220 M60 470 L640 220 M-20 180 L420 560" />
          <path d="M120 760 L260 330 L640 520" />
        </svg>
        <div className="relative z-[1] flex flex-col h-full w-full p-11">
          <div className="flex items-center gap-3.5">
            <span className="rn-login-tile"><RnLogo brand={brand} size={36} onColor title="" /></span>
            <span className="leading-tight">
              <span className="block text-[16px] font-semibold tracking-[0.16em] text-white">RAVINARAYAN</span>
              <span className="block text-[11px] font-medium tracking-[0.22em] rn-login-accent">{erp ? "PG & TIFFIN" : "DELIVERY"}</span>
            </span>
          </div>
          <div className="my-auto pt-10">
            <p className="rn-login-headline">
              {erp ? "Management," : "Deliveries,"}
              <br />
              made simpler.
            </p>
            <div className="mt-9 grid grid-cols-2 gap-2.5 max-w-[380px]">
              {(erp
                ? [
                    [BedDouble, "Residents"],
                    [DoorOpen, "Rooms & beds"],
                    [UtensilsCrossed, "Tiffin & orders"],
                    [ReceiptText, "Billing"],
                  ]
                : [
                    [MapPin, "Today’s stops"],
                    [QrCode, "UPI payments"],
                    [Wallet, "Cash collected"],
                    [HandCoins, "Handover"],
                  ]
              ).map(([Icon, label]) => {
                const I = Icon as React.ElementType;
                return (
                  <span key={label as string} className="rn-login-chip">
                    <I className="w-4 h-4 rn-login-accent" />
                    {label as string}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col justify-center rn-login-formside">
      {erp ? (
        <header className="lg:hidden px-6 pt-[max(2rem,calc(env(safe-area-inset-top)+1.5rem))] pb-7 text-center">
          <div className="rn-logo-in inline-block mb-3">
            <RnLogo brand="standard" size={96} title="" />
          </div>
          <p className="rn-login-mark">Ravinarayan</p>
          <p className="rn-login-sub">PG &amp; Tiffin</p>
        </header>
      ) : (
      <header className="lg:hidden relative px-6 pt-[max(3.5rem,calc(env(safe-area-inset-top)+2.5rem))] pb-24 sm:pb-28 text-center overflow-hidden" style={{ background: t.hero }}>
        <div aria-hidden="true" className="absolute -right-16 -top-16 w-64 h-64 rounded-full opacity-[0.07] bg-white" />
        <div aria-hidden="true" className="absolute -left-20 bottom-0 w-56 h-56 rounded-full opacity-[0.05] bg-white" />
        <div className="relative rn-logo-in inline-block">
          <RnLogo brand={brand} size={104} onColor className="drop-shadow-[0_8px_18px_rgba(0,0,0,0.22)]" />
        </div>
        <p className="relative mt-4 text-[28px] font-extrabold tracking-[-0.02em] text-white">Ravinarayan</p>
        <p className="relative mt-0.5 text-[13px] font-semibold tracking-[0.18em] uppercase" style={{ color: t.caption }}>
          {brand === "delivery" ? "Delivery" : "PG & Tiffin"}
        </p>
      </header>
      )}

      {/* Form card */}
      <section className={erp ? "px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:p-0" : "relative -mt-16 sm:-mt-20 lg:mt-0 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:p-0 flex-1 lg:flex-none"}>
        <div className={`${erp ? "rn-login-card mx-auto w-full max-w-[420px] px-5 sm:px-8 pt-7 pb-8" : "mx-auto w-full max-w-[420px] bg-white rounded-[28px] shadow-[0_18px_50px_-20px_rgba(15,42,29,0.35)] px-5 sm:px-7 pt-6 pb-7"} lg:!bg-transparent lg:!border-transparent lg:!shadow-none lg:![backdrop-filter:none] lg:!max-w-[380px] lg:!px-0`}>
          <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-[#16241B] rn-login-title">{step === "LOGIN" ? <><span className="lg:hidden">Sign in</span><span className="hidden lg:inline">Welcome back</span></> : titles[step]}</h1>
          {step === "OTP" && (
            <p className="mt-1 text-[14px] text-[#5B6B5F]">
              Code sent to <span className="font-semibold text-[#16241B]">{maskedEmail || "your email"}</span>
            </p>
          )}

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
                    <span className="lg:hidden">Forgot?</span>
                    <span className="hidden lg:inline underline decoration-dotted underline-offset-4">Forgot password?</span>
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
            <form ref={otpFormRef} method="post" onSubmit={handleOtpVerify} className="mt-5 space-y-4" noValidate>
              <label htmlFor="otp" className="sr-only">
                6-digit code
              </label>
              <OtpBoxes
                value={otp}
                disabled={isVerifyingOtp || isResendingOtp}
                ring={t.ring}
                focusColor={t.focus}
                onChange={(v) => {
                  setOtp(v);
                  if (errorMessage) setErrorMessage(null);
                }}
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
      </div>
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
        <label htmlFor={id} className="text-[13px] font-semibold text-[#2B3A30] lg:text-[11.5px] lg:font-bold lg:uppercase lg:tracking-[0.12em] lg:text-[#1A2E20]">
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
      {busy ? busyLabel : (
        <>
          {children}
          <ArrowRight className="hidden lg:block w-[18px] h-[18px]" />
        </>
      )}
    </button>
  );
}

/**
 * The 6-digit code as six boxes: typing moves to the next box, Backspace goes back, and pasting or
 * the phone's one-time-code suggestion fills all six at once.
 */
function OtpBoxes({ value, onChange, disabled, ring, focusColor }: { value: string; onChange: (v: string) => void; disabled?: boolean; ring: string; focusColor: string }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const [focus, setFocus] = useState<number | null>(null);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || "");
  const put = (from: number, text: string) => {
    const clean = text.replace(/\D/g, "");
    if (!clean) return;
    const next = (value.slice(0, from) + clean).slice(0, 6);
    onChange(next);
    refs.current[Math.min(next.length, 5)]?.focus();
  };
  useEffect(() => {
    refs.current[Math.min(value.length, 5)]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex items-center justify-between gap-2" role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          id={i === 0 ? "otp" : undefined}
          name={i === 0 ? "otp" : undefined}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1}`}
          maxLength={i === 0 ? 6 : 1}
          disabled={disabled}
          value={d}
          onFocus={(e) => {
            setFocus(i);
            e.currentTarget.select();
          }}
          onBlur={() => setFocus(null)}
          onPaste={(e) => {
            e.preventDefault();
            put(0, e.clipboardData.getData("text"));
          }}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (v.length > 1) return put(i === 0 ? 0 : i, v);
            const next = (value.slice(0, i) + v + value.slice(i + 1)).slice(0, 6);
            onChange(v ? next : value.slice(0, i) + value.slice(i + 1));
            if (v && i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) {
              e.preventDefault();
              onChange(value.slice(0, i - 1) + value.slice(i));
              refs.current[i - 1]?.focus();
            } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            else if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
          }}
          className="w-full min-w-0 h-14 sm:h-16 rounded-2xl border bg-[#FBFAF6] text-center text-[26px] font-bold tabular-nums text-[#16241B] outline-none transition-[box-shadow,border-color,background-color] disabled:opacity-60"
          style={{
            borderColor: focus === i ? focusColor : d ? "#BFB6A4" : "#DCD5C6",
            boxShadow: focus === i ? `0 0 0 4px ${ring}` : "none",
            background: focus === i || d ? "#FFFFFF" : "#FBFAF6",
          }}
        />
      ))}
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full h-10 text-[13px] font-semibold text-[#5B6B5F]">
      Back to sign in
    </button>
  );
}
