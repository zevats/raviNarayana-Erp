"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TiffinRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/orders");
  }, [router]);

  return (
    <div className="p-12 text-center text-xs font-serif text-[#8E9F89]">
      Consolidated operational workflow: Redirecting to Orders...
    </div>
  );
}
