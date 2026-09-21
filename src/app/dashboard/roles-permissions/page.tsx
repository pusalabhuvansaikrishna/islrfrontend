"use client";

import { useState } from "react";
import styles from "./page.module.css";
import RolesPanel from "./RolesPanel";
import PermissionsPanel from "./PermissionsPanel";
import RequireRole from "@/components/RequireRole";

type Tab = "roles" | "permissions";

export default function RolesPermissionsPage() {
  const [tab, setTab] = useState<Tab>("roles");

  return (
    <RequireRole>
      <div className={styles.wrap}>
        <div className={styles.pageHeader}>
          <div>
            <h2 className={styles.welcomeText}>Roles &amp; Permissions</h2>
            <p className={styles.subtitle}>
              Control what each role can do across the app.
            </p>
          </div>

          <div className={styles.segmented} role="tablist" aria-label="Section">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "roles"}
              className={`${styles.segmentBtn} ${
                tab === "roles" ? styles.segmentBtnActive : ""
              }`}
              onClick={() => setTab("roles")}
            >
              Roles
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "permissions"}
              className={`${styles.segmentBtn} ${
                tab === "permissions" ? styles.segmentBtnActive : ""
              }`}
              onClick={() => setTab("permissions")}
            >
              Permissions
            </button>
          </div>
        </div>

        {tab === "roles" ? <RolesPanel /> : <PermissionsPanel />}
      </div>
    </RequireRole>
  );
}