import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getReceiptByToken } from "@/server/finance/receiptService";
import { PublicReceipt } from "@/modules/billing/PublicReceipt";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Receipt",
  robots: { index: false, follow: false },
};

/** The receipt behind a share link (WhatsApp). No sign-in: the link shows only that one receipt. */
export default async function ReceiptPage({ params, searchParams }: { params: { token: string }; searchParams: { print?: string; app?: string } }) {
  const receipt = await getReceiptByToken(params.token).catch(() => null);
  if (!receipt) notFound();
  return <PublicReceipt receipt={receipt} print={searchParams.print === "1"} inApp={searchParams.app === "1"} />;
}
