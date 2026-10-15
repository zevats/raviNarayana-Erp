import React, { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/modules/auth/components/LoginForm";
import { validateSession, ERP_COOKIE_NAME } from "@/server/authentication/auth";
import { Loader2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const cookieStore = cookies();
  const sessionToken = cookieStore.get(ERP_COOKIE_NAME)?.value;

  if (sessionToken && sessionToken.length >= 32) {
    const user = validateSession(sessionToken);
    if (user) {
      redirect("/dashboard");
    }
  }

  return (
    <main className="min-h-screen w-full flex flex-col items-center justify-center px-4 py-6 sm:p-6 lg:p-8 bg-[#FAF8F5] bg-[radial-gradient(ellipse_at_top,_#F3EDE2_0%,_#FAF8F5_65%)] overflow-x-hidden">
      <div className="w-full max-w-[350px] sm:max-w-md mx-auto relative z-10 my-auto">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-20 text-xs font-sans font-semibold uppercase tracking-widest text-[#445448]">
              <Loader2 className="w-5 h-5 animate-spin text-[#1A2E20] mr-2.5" />
              <span>Loading Management Portal...</span>
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
