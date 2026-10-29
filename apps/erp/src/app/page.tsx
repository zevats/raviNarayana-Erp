import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession, ERP_COOKIE_NAME } from "@/server/authentication/auth";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const cookieStore = cookies();
  const sessionToken = cookieStore.get(ERP_COOKIE_NAME)?.value;

  if (sessionToken) {
    const user = await validateSession(sessionToken);
    if (user) {
      // Role-aware primary landing
      if (user.role === "DELIVERY_PERSON") {
        redirect("/delivery");
      }
      redirect("/dashboard");
    }
  }

  redirect("/login");
}
