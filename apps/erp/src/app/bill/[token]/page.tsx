import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBillByToken } from "@/server/finance/billService";
import { PublicBill } from "@/modules/billing/PublicBill";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bill",
  robots: { index: false, follow: false },
};

/** The bill behind a share link (WhatsApp). No sign-in: the link shows only that one bill. */
export default async function BillPage({ params, searchParams }: { params: { token: string }; searchParams: { print?: string; app?: string } }) {
  const bill = await getBillByToken(params.token).catch(() => null);
  if (!bill) notFound();
  return <PublicBill bill={bill} print={searchParams.print === "1"} inApp={searchParams.app === "1"} />;
}
