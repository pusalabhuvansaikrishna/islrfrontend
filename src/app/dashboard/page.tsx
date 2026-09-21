"use client";

import styles from "./page.module.css";
import DashboardInsightsSection from "@/components/dashboard/DashboardInsights";

export default function DashboardPage() {
  return (
    <div className={styles.content}>
      {/* Renders nothing if the user lacks the ReadDashboard permission. */}
      <DashboardInsightsSection />
    </div>
  );
}