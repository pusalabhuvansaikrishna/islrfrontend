"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./Sidebar.module.css";

type IconProps = { className?: string };

type NavItem = {
  label: string;
  href: string;
  icon: (props: IconProps) => ReactNode;
};

const PRIVILEGED_ROLES = ["SuperAdmin", "Admin"];

const GENERAL_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: DashboardIcon },
  { label: "Jobs", href: "/dashboard/jobs", icon: JobsIcon },
  { label: "Settings", href: "/dashboard/settings", icon: SettingsIcon },
];

// Visible to SuperAdmin and Admin only — kept separate from GENERAL_ITEMS so
// they can be rendered as their own group, below a divider.
const RESTRICTED_ITEMS: NavItem[] = [
  { label: "Admins", href: "/dashboard/admins", icon: ShieldIcon },
  { label: "Editors", href: "/dashboard/editors", icon: EditIcon },
  { label: "Users", href: "/dashboard/users", icon: UsersIcon },
  { label: "Roles and Permissions", href: "/dashboard/roles-permissions", icon: KeyIcon },
  { label: "Signer", href: "/dashboard/signer", icon: SignerIcon },
];

export default function Sidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const canSeeRestricted = PRIVILEGED_ROLES.includes(role);

  return (
    <nav className={styles.sidebar} aria-label="Dashboard navigation">
      <NavList items={GENERAL_ITEMS} pathname={pathname} />

      {canSeeRestricted && (
        <>
          <div className={styles.divider} role="separator" />
          <p className={styles.groupLabel}>SuperAdmin Sections</p>
          <NavList items={RESTRICTED_ITEMS} pathname={pathname} />
        </>
      )}
    </nav>
  );
}

function NavList({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <ul className={styles.list}>
      {items.map((item) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className={`${styles.link} ${isActive ? styles.linkActive : ""}`}
            >
              <Icon className={styles.icon} />
              <span>{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function DashboardIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function JobsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <rect x="2.5" y="5.5" width="15" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7 5.5V4.2c0-.7.6-1.2 1.2-1.2h3.6c.7 0 1.2.6 1.2 1.2v1.3" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M2.5 10h15" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ShieldIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <path d="M10 2.5l6 2.2v4.6c0 4-2.6 6.9-6 8.2-3.4-1.3-6-4.2-6-8.2V4.7l6-2.2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function EditIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <path d="M12.9 3.5l3.6 3.6-9 9-4 .8.8-4 8.6-9.4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function UsersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <circle cx="7.2" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.5 16c0-2.6 2.1-4.2 4.7-4.2s4.7 1.6 4.7 4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="14.2" cy="7" r="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12.8 11.9c1.9.2 3.7 1.5 3.7 4.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function KeyIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <circle cx="6.5" cy="13.5" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.6 11.4L15 5m0 0v3m0-3h-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SignerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <path d="M3 15.5c2-4 3.8-7.6 5.6-9.4 1-.9 2.2-.3 2 .9-.3 1.6-1.6 3.6-2.6 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8.4 12.4c1.6-.4 3.2-1.6 4.6-3 1-1 2.3-.5 1.9.8-.3 1-1 2-1.7 2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 13c1-.4 2-1.2 2.8-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3 17h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 3v1.6M10 15.4V17M17 10h-1.6M4.6 10H3M14.9 5.1l-1.1 1.1M6.2 13.7l-1.1 1.1M14.9 14.9l-1.1-1.1M6.2 6.2L5.1 5.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}