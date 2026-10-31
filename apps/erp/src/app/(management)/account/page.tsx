"use client";

import React from "react";
import { useCurrentUser } from "@/components/auth/CurrentUserContext";
import { AccountPage } from "@/modules/account/AccountPage";

/** My account: profile, work summary, password and email (every role). */
export default function MyAccountPage() {
  const user = useCurrentUser();
  if (!user) return null;
  return <AccountPage user={user} />;
}
