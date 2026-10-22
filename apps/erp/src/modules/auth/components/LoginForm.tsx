"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, User, Eye, EyeOff, AlertCircle, ArrowUpRight, Loader2, Shield, KeyRound, CheckCircle2 } from "lucide-react";

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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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

  // Handle Step 1: Username/Email + Password
  const handlePrimaryLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanIdentifier = identifier.trim();
    if (!cleanIdentifier || !password) {
      setErrorMessage("Please enter your authorized username or email and password.");
      return;
    }

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
        setLoginPhase("IDLE");
        setErrorMessage(data.error || "Invalid username or password. Please verify your credentials.");
        setIsSubmittingLogin(false);
        return;
      }

      if (data.status === "OTP_REQUIRED") {
        setLoginPhase("CODE_SENT");
        setChallengeId(data.challengeId);
        setMaskedEmail(data.emailMasked);
        setResendCooldown(60);

        // Brief affirmative transition before displaying OTP input
        setTimeout(() => {
          setStep("OTP");
          setIsSubmittingLogin(false);
          setLoginPhase("IDLE");
        }, 350);
        return;
      }

      // Direct session login fallback if OTP is not required
      setLoginPhase("IDLE");
      router.push(nextUrl);
      router.refresh();
    } catch (err) {
      clearTimeout(phaseTimer);
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
        setErrorMessage(data.error || "Invalid verification code. Please check and try again.");
        setIsVerifyingOtp(false);
        return;
      }

      router.push(nextUrl);
      router.refresh();
    } catch (err) {
      console.error("OTP verification error:", err);
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

  return (
    <div className="w-full max-w-[350px] sm:max-w-md mx-auto">
      {/* Brand Header */}
      <div className="text-center mb-6 sm:mb-7">
        <div className="relative w-32 sm:w-36 h-18 sm:h-20 rounded-2xl bg-[#121A15] border border-[#B58A57]/50 ring-1 ring-[#B58A57]/25 shadow-lg shadow-[#1A2E20]/25 flex items-center justify-center p-1.5 overflow-hidden mx-auto mb-3.5 group transition-transform">
          <Image
            src="/logo.png"
            alt="Ravinarayan PG Guesthouse Crest"
            width={160}
            height={106}
            priority
            className="w-full h-full object-contain scale-[1.38] transition-transform duration-300 group-hover:scale-[1.42]"
          />
        </div>

        <div className="flex items-center justify-center gap-2 sm:gap-3 mb-1.5">
          <span className="w-6 sm:w-10 h-[1px] bg-[#B58A57]/45" />
          <span className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-sans font-bold text-[#654735]">
            MANAGEMENT &bull; PORTAL
          </span>
          <span className="w-6 sm:w-10 h-[1px] bg-[#B58A57]/45" />
        </div>

        <h1 className="font-serif text-3xl sm:text-4xl text-[#1A2E20] font-bold tracking-tight">
          Ravinarayan ERP
        </h1>
        <p className="text-xs sm:text-sm text-[#445448] font-medium mt-1">
          Internal Operations &amp; Management Portal
        </p>
      </div>

      {/* Main Card */}
      <div className="w-full bg-white rounded-2xl sm:rounded-3xl border border-[#D5CEBF] p-5 sm:p-8 shadow-xl shadow-[#1A2E20]/6 relative overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#1A2E20] via-[#B58A57] to-[#1A2E20]" />

        {/* Card Header */}
        <div className="mb-5 pb-3.5 border-b border-[#E6E0D2]">
          <h2 className="font-serif text-xl sm:text-2xl text-[#1A2E20] font-bold">
            {step === "LOGIN" && "Staff Authentication"}
            {step === "OTP" && "Two-Factor Verification"}
            {step === "FORGOT" && "Recover Account"}
            {step === "RESET" && "Set New Password"}
          </h2>
          <p className="text-xs sm:text-sm text-[#445448] font-normal mt-1 leading-relaxed">
            {step === "LOGIN" && "Enter authorized credentials to access management records."}
            {step === "OTP" && `A 6-digit verification code was sent to ${maskedEmail || "your authorized email"}.`}
            {step === "FORGOT" && "Enter your username or email to receive a secure recovery link."}
            {step === "RESET" && "Create a secure password with at least 12 characters."}
          </p>
        </div>

        {/* Inline Alerts */}
        {errorMessage && (
          <div
            role="alert"
            className="mb-5 p-3.5 rounded-xl bg-[#FDF0ED] border border-[#F5C8BF] text-[#842213] text-xs sm:text-sm font-sans font-medium flex items-start gap-2.5 animate-fadeIn"
          >
            <AlertCircle className="w-4 h-4 text-[#842213] shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">{errorMessage}</div>
          </div>
        )}

        {successMessage && (
          <div
            role="status"
            className="mb-5 p-3.5 rounded-xl bg-[#EAF5EC] border border-[#BCE1C2] text-[#1E5D2A] text-xs sm:text-sm font-sans font-medium flex items-start gap-2.5 animate-fadeIn"
          >
            <CheckCircle2 className="w-4 h-4 text-[#1E5D2A] shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">{successMessage}</div>
          </div>
        )}

        {/* Step 1: Login Form */}
        {step === "LOGIN" && (
          <form onSubmit={handlePrimaryLogin} className="w-full space-y-4 sm:space-y-4.5" noValidate>
            <div>
              <label
                htmlFor="identifier"
                className="block text-xs uppercase font-sans tracking-wider text-[#1A2E20] font-bold mb-1.5"
              >
                Username or Email
              </label>
              <div className="relative rounded-xl border border-[#B8AF9E] bg-[#FAF9F6] focus-within:border-[#1A2E20] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#B58A57]/30 transition-all">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#5D7656]">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="identifier"
                  name="identifier"
                  type="text"
                  autoComplete="username"
                  required
                  disabled={isSubmittingLogin}
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="e.g. admin or staff@ravinarayan.in"
                  className="w-full min-w-0 pl-10 pr-4 py-3 bg-transparent text-sm font-sans font-medium text-[#1A2E20] placeholder-[#5E7060] focus:outline-none rounded-xl"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="password"
                  className="block text-xs uppercase font-sans tracking-wider text-[#1A2E20] font-bold"
                >
                  Security Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setStep("FORGOT");
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className="text-xs font-sans font-semibold text-[#654735] hover:text-[#1A2E20] underline transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative rounded-xl border border-[#B8AF9E] bg-[#FAF9F6] focus-within:border-[#1A2E20] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#B58A57]/30 transition-all">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#5D7656]">
                  <Lock className="w-4 h-4" />
                </div>
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
                  placeholder="Enter password"
                  className="w-full min-w-0 pl-10 pr-11 py-3 bg-transparent text-sm font-sans font-medium text-[#1A2E20] placeholder-[#5E7060] focus:outline-none rounded-xl"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[#5D7656] hover:text-[#1A2E20] focus:outline-none focus:text-[#1A2E20] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <button
                type="submit"
                disabled={isSubmittingLogin}
                className="w-full inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] active:bg-[#121A15] text-white text-sm font-sans font-bold tracking-wider uppercase transition-all shadow-md hover:shadow-lg shadow-[#1A2E20]/20 disabled:opacity-75 disabled:cursor-not-allowed group focus:outline-none focus:ring-2 focus:ring-[#B58A57] focus:ring-offset-2"
              >
                {loginPhase === "SIGNING_IN" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#C89F6B]" />
                    <span>Signing in…</span>
                  </>
                ) : loginPhase === "SENDING_CODE" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#D4AF37]" />
                    <span>Sending verification code…</span>
                  </>
                ) : loginPhase === "CODE_SENT" ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-[#8E9F89]" />
                    <span>Code sent</span>
                  </>
                ) : (
                  <>
                    <span>Continue to OTP</span>
                    <ArrowUpRight className="w-4 h-4 text-[#D4AF37] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </>
                )}
              </button>
              {loginPhase === "SENDING_CODE" && (
                <div className="flex items-center justify-center gap-2 text-xs font-sans text-[#5E7060] bg-[#1A2E20]/5 rounded-lg py-1.5 px-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#B58A57] animate-ping" />
                  <span>Submitting OTP to your authorized email address…</span>
                </div>
              )}
            </div>
          </form>
        )}

        {/* Step 2: OTP Verification Form */}
        {step === "OTP" && (
          <form onSubmit={handleOtpVerify} className="w-full space-y-4 sm:space-y-4.5" noValidate>
            <div>
              <label
                htmlFor="otp"
                className="block text-xs uppercase font-sans tracking-wider text-[#1A2E20] font-bold mb-1.5"
              >
                6-Digit Security Code
              </label>
              <div className="relative rounded-xl border border-[#B8AF9E] bg-[#FAF9F6] focus-within:border-[#1A2E20] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#B58A57]/30 transition-all">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#5D7656]">
                  <KeyRound className="w-4 h-4" />
                </div>
                <input
                  id="otp"
                  name="otp"
                  type="text"
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
                  placeholder="123456"
                  className="w-full min-w-0 pl-10 pr-4 py-3 bg-transparent text-lg tracking-[0.3em] font-mono font-bold text-[#1A2E20] placeholder-[#B8AF9E] focus:outline-none rounded-xl text-center"
                />
              </div>
              <p className="text-[11px] text-[#5E7060] font-sans mt-1">
                Valid for 10 minutes &bull; Max 3 verification attempts
              </p>
            </div>

            <div className="pt-2 space-y-3">
              <button
                type="submit"
                disabled={isVerifyingOtp || isResendingOtp || otp.length !== 6}
                className="w-full inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] active:bg-[#121A15] text-white text-sm font-sans font-bold tracking-wider uppercase transition-all shadow-md hover:shadow-lg shadow-[#1A2E20]/20 disabled:opacity-60 disabled:cursor-not-allowed group focus:outline-none focus:ring-2 focus:ring-[#B58A57] focus:ring-offset-2"
              >
                {isVerifyingOtp ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#C89F6B]" />
                    <span>Verifying code…</span>
                  </>
                ) : (
                  <>
                    <span>Verify &amp; Sign In</span>
                    <ArrowUpRight className="w-4 h-4 text-[#D4AF37] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </>
                )}
              </button>

              <div className="flex items-center justify-between text-xs font-sans pt-1">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={resendCooldown > 0 || isResendingOtp || isVerifyingOtp}
                  className="text-[#654735] hover:text-[#1A2E20] font-semibold disabled:text-[#8E9F89] disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5"
                >
                  {isResendingOtp ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#654735]" />
                      <span>Sending new code…</span>
                    </>
                  ) : resendCooldown > 0 ? (
                    `Resend code in ${resendCooldown}s`
                  ) : (
                    "Resend verification code"
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStep("LOGIN");
                    setOtp("");
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className="text-[#654735] hover:text-[#1A2E20] font-semibold transition-colors"
                >
                  &larr; Back to login
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Step 3: Forgot Password Form */}
        {step === "FORGOT" && (
          <form onSubmit={handleForgotPassword} className="w-full space-y-4 sm:space-y-4.5" noValidate>
            <div>
              <label
                htmlFor="forgotIdentifier"
                className="block text-xs uppercase font-sans tracking-wider text-[#1A2E20] font-bold mb-1.5"
              >
                Username or Registered Email
              </label>
              <div className="relative rounded-xl border border-[#B8AF9E] bg-[#FAF9F6] focus-within:border-[#1A2E20] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#B58A57]/30 transition-all">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#5D7656]">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="forgotIdentifier"
                  type="text"
                  required
                  autoFocus
                  disabled={isSubmittingForgot}
                  value={forgotIdentifier}
                  onChange={(e) => {
                    setForgotIdentifier(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="e.g. admin or staff@ravinarayan.in"
                  className="w-full min-w-0 pl-10 pr-4 py-3 bg-transparent text-sm font-sans font-medium text-[#1A2E20] placeholder-[#5E7060] focus:outline-none rounded-xl"
                />
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <button
                type="submit"
                disabled={isSubmittingForgot}
                className="w-full inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] active:bg-[#121A15] text-white text-sm font-sans font-bold tracking-wider uppercase transition-all shadow-md hover:shadow-lg shadow-[#1A2E20]/20 disabled:opacity-60 disabled:cursor-not-allowed group focus:outline-none focus:ring-2 focus:ring-[#B58A57] focus:ring-offset-2"
              >
                {isSubmittingForgot ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#C89F6B]" />
                    <span>Sending Recovery Link...</span>
                  </>
                ) : (
                  <span>Send Recovery Link</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("LOGIN");
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className="w-full text-center text-xs font-sans font-semibold text-[#654735] hover:text-[#1A2E20] py-1.5 transition-colors"
              >
                &larr; Return to Sign In
              </button>
            </div>
          </form>
        )}

        {/* Step 4: Reset Password Form (token from email link) */}
        {step === "RESET" && (
          <form onSubmit={handleResetPassword} className="w-full space-y-4 sm:space-y-4.5" noValidate>
            <div>
              <label
                htmlFor="newPassword"
                className="block text-xs uppercase font-sans tracking-wider text-[#1A2E20] font-bold mb-1.5"
              >
                New Security Password
              </label>
              <div className="relative rounded-xl border border-[#B8AF9E] bg-[#FAF9F6] focus-within:border-[#1A2E20] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#B58A57]/30 transition-all">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#5D7656]">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="newPassword"
                  type={showNewPassword ? "text" : "password"}
                  required
                  disabled={isSubmittingReset}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="Minimum 12 characters"
                  className="w-full min-w-0 pl-10 pr-11 py-3 bg-transparent text-sm font-sans font-medium text-[#1A2E20] placeholder-[#5E7060] focus:outline-none rounded-xl"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  aria-label={showNewPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[#5D7656] hover:text-[#1A2E20]"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-xs uppercase font-sans tracking-wider text-[#1A2E20] font-bold mb-1.5"
              >
                Confirm New Password
              </label>
              <div className="relative rounded-xl border border-[#B8AF9E] bg-[#FAF9F6] focus-within:border-[#1A2E20] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#B58A57]/30 transition-all">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#5D7656]">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  disabled={isSubmittingReset}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="Re-enter password"
                  className="w-full min-w-0 pl-10 pr-4 py-3 bg-transparent text-sm font-sans font-medium text-[#1A2E20] placeholder-[#5E7060] focus:outline-none rounded-xl"
                />
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <button
                type="submit"
                disabled={isSubmittingReset}
                className="w-full inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] active:bg-[#121A15] text-white text-sm font-sans font-bold tracking-wider uppercase transition-all shadow-md hover:shadow-lg shadow-[#1A2E20]/20 disabled:opacity-60 disabled:cursor-not-allowed group focus:outline-none focus:ring-2 focus:ring-[#B58A57] focus:ring-offset-2"
              >
                {isSubmittingReset ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#C89F6B]" />
                    <span>Updating Password...</span>
                  </>
                ) : (
                  <span>Update Password &amp; Invalidate Sessions</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("LOGIN");
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className="w-full text-center text-xs font-sans font-semibold text-[#654735] hover:text-[#1A2E20] py-1.5 transition-colors"
              >
                &larr; Return to Sign In
              </button>
            </div>
          </form>
        )}

        {/* Security Note */}
        <div className="mt-5 pt-3.5 border-t border-[#E6E0D2] flex items-center justify-center gap-1.5 text-center text-[11px] sm:text-xs font-sans font-medium text-[#445448]">
          <Shield className="w-4 h-4 text-[#5D7656] shrink-0" />
          <span>Internal access restricted &bull; Encrypted Session &bull; 2FA Protected</span>
        </div>
      </div>

      {/* Return to Public Website */}
      <div className="text-center mt-4 sm:mt-5">
        <a
          href={process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}
          className="inline-flex items-center gap-1.5 text-xs font-sans font-semibold text-[#263B2D] hover:text-[#B58A57] transition-colors underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-[#B58A57] rounded px-1.5 py-0.5"
        >
          <span>&larr;</span>
          <span>Return to Ravinarayan Public Website</span>
        </a>
      </div>
    </div>
  );
}
