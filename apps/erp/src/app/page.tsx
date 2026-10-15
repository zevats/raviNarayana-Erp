import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession, ERP_COOKIE_NAME } from "@/server/authentication/auth";

export const dynamic = "force-dynamic";

export default function RootPage() {
  const cookieStore = cookies();
  const sessionToken = cookieStore.get(ERP_COOKIE_NAME)?.value;

  if (sessionToken && validateSession(sessionToken)) {
    redirect("/dashboard");
  } else {
    redirect("/login");
  }
}
