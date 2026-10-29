import { redirect } from "next/navigation";

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams.token;
  if (token) {
    redirect(`/login?token=${encodeURIComponent(token)}`);
  }
  redirect("/login");
}
