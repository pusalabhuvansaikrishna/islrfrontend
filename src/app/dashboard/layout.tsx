"use client";

import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import styles from "./layout.module.css";

function DashboardShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  // AuthProvider itself redirects to "/" if there's no valid session, so by
  // the time loading is false and user is still null, a redirect is already
  // underway — render nothing rather than flash the shell.
  if (loading || !user) {
    return (
      <div className={styles.loadingWrap}>
        <span className={styles.spinner} />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <Header user={user} />
      <div className={styles.body}>
        <Sidebar role={user.role} />
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShell>{children}</DashboardShell>
    </AuthProvider>
  );
}