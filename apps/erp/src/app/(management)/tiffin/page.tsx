import { redirect } from "next/navigation";

// Legacy route consolidated into Orders (Task 01B.70). Redirect on the server so the browser
// never downloads and renders an intermediate page.
export default function TiffinRedirectPage() {
  redirect("/orders");
}
