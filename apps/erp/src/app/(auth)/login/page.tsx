import React, { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/modules/auth/components/LoginForm";
import { validateSession, ERP_COOKIE_NAME } from "@/server/authentication/auth";
import { getEmailAdapter } from "@/server/notifications/emailAdapter";
import { BikeLoader } from "@/components/feedback/BikeLoader";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const cookieStore = cookies();
  const sessionToken = cookieStore.get(ERP_COOKIE_NAME)?.value;

  if (sessionToken && sessionToken.length >= 32) {
    const user = await validateSession(sessionToken);
    if (user) {
      redirect("/dashboard");
    }
  }

  // Pre-warm SMTP pool in background so OTP submission experiences zero connection setup delay
  try {
    const adapter = getEmailAdapter();
    if (typeof adapter?.warmUp === "function") {
      adapter.warmUp().catch(() => {});
    }
  } catch {
    // Non-fatal if offline/mock
  }

  return (
    <main className="min-h-screen w-full flex flex-col items-center justify-center px-4 py-6 sm:p-6 lg:p-8 bg-[#FAF8F5] bg-[radial-gradient(ellipse_at_top,_#F3EDE2_0%,_#FAF8F5_65%)] overflow-x-hidden">
      <div className="w-full max-w-[350px] sm:max-w-md mx-auto relative z-10 my-auto">
        <Suspense
          fallback={
            <BikeLoader tone="forest" label="Opening…" className="py-20" />
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
