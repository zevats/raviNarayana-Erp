"use client";

import React, { useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, User, Eye, EyeOff, AlertCircle, ArrowUpRight, Loader2, Shield } from "lucide-react";

function sanitizeNextUrl(rawUrl: string | null): string {
  if (!rawUrl) return "/dashboard";
  // Must be a relative path starting with a single '/'
  // Reject protocol-relative URLs (//example.com), Windows backslashes (/\\), and schema colons
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

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanIdentifier = identifier.trim();
    if (!cleanIdentifier || !password) {
      setErrorMessage("Please enter your authorized username or email and password.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: cleanIdentifier,
          password,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setErrorMessage(data.error || "Invalid username or password. Please verify your credentials.");
        setIsLoading(false);
        return;
      }

      router.push(nextUrl);
      router.refresh();
    } catch (err) {
      console.error("Login request error:", err);
      setErrorMessage("Unable to connect to the authentication service. Please check your network connection.");
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[350px] sm:max-w-md mx-auto">
      
      {/* Brand Header (Faithful to Ravinarayan Botanical Identity with Elevated Contrast) */}
      <div className="text-center mb-6 sm:mb-7">
        
        {/* Crest Emblem in Nocturnal Botanical Container */}
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

        {/* Hairline Subtitle with Walnut Accent */}
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

      {/* Login Card */}
      <div className="w-full bg-white rounded-2xl sm:rounded-3xl border border-[#D5CEBF] p-5 sm:p-8 shadow-xl shadow-[#1A2E20]/6 relative overflow-hidden">
        {/* Architectural Brass Top Accent */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#1A2E20] via-[#B58A57] to-[#1A2E20]" />
        
        <div className="mb-5 pb-3.5 border-b border-[#E6E0D2]">
          <h2 className="font-serif text-xl sm:text-2xl text-[#1A2E20] font-bold">
            Staff Authentication
          </h2>
          <p className="text-xs sm:text-sm text-[#445448] font-normal mt-1 leading-relaxed">
            Enter authorized credentials to access management records.
          </p>
        </div>

        {/* Inline Error Alert */}
        {errorMessage && (
          <div
            role="alert"
            className="mb-5 p-3.5 rounded-xl bg-[#FDF0ED] border border-[#F5C8BF] text-[#842213] text-xs sm:text-sm font-sans font-medium flex items-start gap-2.5 animate-fadeIn"
          >
            <AlertCircle className="w-4 h-4 text-[#842213] shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">{errorMessage}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="w-full space-y-4 sm:space-y-4.5" noValidate>
          
          {/* Identifier Input */}
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
                disabled={isLoading}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="e.g. admin or staff@ravinarayan.in"
                className="w-full min-w-0 pl-10 pr-4 py-3 bg-transparent text-sm font-sans font-medium text-[#1A2E20] placeholder-[#5E7060] focus:outline-none rounded-xl"
              />
            </div>
          </div>

          {/* Password Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="password"
                className="block text-xs uppercase font-sans tracking-wider text-[#1A2E20] font-bold"
              >
                Security Password
              </label>
              <span className="text-xs font-sans font-semibold text-[#654735]">
                Case-sensitive
              </span>
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
                disabled={isLoading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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

          {/* Submit Action */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] active:bg-[#121A15] text-white text-sm font-sans font-bold tracking-wider uppercase transition-all shadow-md hover:shadow-lg shadow-[#1A2E20]/20 disabled:opacity-60 disabled:cursor-not-allowed group focus:outline-none focus:ring-2 focus:ring-[#B58A57] focus:ring-offset-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#C89F6B]" />
                  <span>Verifying Session...</span>
                </>
              ) : (
                <>
                  <span>Sign In to ERP</span>
                  <ArrowUpRight className="w-4 h-4 text-[#D4AF37] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </>
              )}
            </button>
          </div>
        </form>

        {/* Security Note */}
        <div className="mt-5 pt-3.5 border-t border-[#E6E0D2] flex items-center justify-center gap-1.5 text-center text-[11px] sm:text-xs font-sans font-medium text-[#445448]">
          <Shield className="w-4 h-4 text-[#5D7656] shrink-0" />
          <span>Internal access restricted &bull; Encrypted Session</span>
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
