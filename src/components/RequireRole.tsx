"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const PRIVILEGED_ROLES = ["SuperAdmin", "Admin"];

export default function RequireRole({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  const isPrivileged = !!user && PRIVILEGED_ROLES.includes(user.role);

  useEffect(() => {
    if (user && !isPrivileged) {
      router.replace("/dashboard");
    }
  }, [user, isPrivileged, router]);

  if (!isPrivileged) {
    return null;
  }

  return <>{children}</>;
}