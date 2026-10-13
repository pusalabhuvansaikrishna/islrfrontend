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
  /** If set, only these roles see the item. */
  roles?: string[];
};

const PRIVILEGED_ROLES = ["SuperAdmin", "Admin"];
// Roles that can see the recorder section (Jobs + Recorders).
const RECORDER_SECTION_ROLES = ["SuperAdmin", "RecorderAdmin"];
// Roles that can see the Videos section.
const VIDEOS_SECTION_ROLES = ["SuperAdmin", "Admin", "Researcher", "RecorderAdmin"];
// Roles that can see every annotation job raised by users (Annotation Management).
const ANNOTATION_JOBS_ROLES = ["SuperAdmin", "Admin", "RecorderAdmin"];

// Visible to every role.
const GENERAL_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: DashboardIcon },
  { label: "Assigned Sessions", href: "/dashboard/assigned-sessions", icon: AssignedSessionsIcon },
  { label: "Settings", href: "/dashboard/settings", icon: SettingsIcon },
];

// "Annotations" group: the logged-in user's own views.
//  - Submitted: tasks I raised (same roles that can reach the Videos page)
//  - Assigned:  tasks assigned to me (every role)
const ANNOTATION_ITEMS: NavItem[] = [
  { label: "Submitted", href: "/dashboard/annotations/submitted", icon: AnnotationIcon, roles: VIDEOS_SECTION_ROLES },
  { label: "Assigned", href: "/dashboard/annotations/assigned", icon: MyAnnotationJobsIcon },
];

// "Annotation Management" group: SuperAdmin, Admin and RecorderAdmin only.
const ANNOTATION_MANAGEMENT_ITEMS: NavItem[] = [
  { label: "All Annotation Jobs", href: "/dashboard/annotations/all", icon: AnnotationJobsIcon },
];

// Visible to SuperAdmin and RecorderAdmin only.
const RECORDER_ITEMS: NavItem[] = [
  { label: "Jobs", href: "/dashboard/jobs", icon: JobsIcon },
  { label: "Recorders", href: "/dashboard/recorders", icon: RecorderIcon },
];

// Visible to SuperAdmin, Admin, Researcher and RecorderAdmin.
const VIDEOS_ITEMS: NavItem[] = [
  { label: "Videos", href: "/dashboard/videos", icon: VideoIcon },
];

// Visible to SuperAdmin and Admin only — kept separate from GENERAL_ITEMS so
// they can be rendered as their own group, below a divider.
const RESTRICTED_ITEMS: NavItem[] = [
  { label: "Admins", href: "/dashboard/admins", icon: ShieldIcon },
  { label: "Annotators", href: "/dashboard/annotators", icon: EditIcon },
  { label: "Users", href: "/dashboard/users", icon: UsersIcon },
  { label: "Researchers", href: "/dashboard/researchers", icon: ResearcherIcon },
  { label: "Requests", href: "/dashboard/requests", icon: RequestsIcon },
  { label: "Job Requests", href: "/dashboard/job-requests", icon: JobRequestsIcon },
  { label: "Roles and Permissions", href: "/dashboard/roles-permissions", icon: KeyIcon },
  { label: "Signer", href: "/dashboard/signer", icon: SignerIcon },
];

export default function Sidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const canSeeRestricted = PRIVILEGED_ROLES.includes(role);
  const canSeeRecorderSection = RECORDER_SECTION_ROLES.includes(role);
  const canSeeVideosSection = VIDEOS_SECTION_ROLES.includes(role);
  const canSeeAnnotationJobs = ANNOTATION_JOBS_ROLES.includes(role);
  const annotationItems = ANNOTATION_ITEMS.filter((item) => !item.roles || item.roles.includes(role));

  return (
    <nav className={styles.sidebar} aria-label="Dashboard navigation">
      <NavList items={GENERAL_ITEMS} pathname={pathname} />

      <div className={styles.divider} role="separator" />
      <p className={styles.groupLabel}>Annotations</p>
      <NavList items={annotationItems} pathname={pathname} />

      {canSeeAnnotationJobs && (
        <>
          <div className={styles.divider} role="separator" />
          <p className={styles.groupLabel}>Annotation Management</p>
          <NavList items={ANNOTATION_MANAGEMENT_ITEMS} pathname={pathname} />
        </>
      )}

      {canSeeRecorderSection && (
        <>
          <div className={styles.divider} role="separator" />
          <p className={styles.groupLabel}>Recorder Sections</p>
          <NavList items={RECORDER_ITEMS} pathname={pathname} />
        </>
      )}

      {canSeeVideosSection && (
        <>
          <div className={styles.divider} role="separator" />
          <p className={styles.groupLabel}>Videos</p>
          <NavList items={VIDEOS_ITEMS} pathname={pathname} />
        </>
      )}

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

// Calendar with a check — sessions assigned to the logged-in user
function AssignedSessionsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <rect x="2.5" y="4.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.5 8.5h15M6.5 2.5v3M13.5 2.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.5 13l1.8 1.8 3.2-3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Clipboard with a check — annotation tasks assigned to the logged-in user
function MyAnnotationJobsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="3.5" width="12" height="14" rx="1.8" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7.5 3.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7.5 11l1.8 1.8 3.2-3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Stacked layers with a tag line — every annotation job raised by users
function AnnotationJobsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <path d="M10 2.5l7.5 3.8L10 10 2.5 6.3 10 2.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M2.5 10L10 13.7 17.5 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 13.7L10 17.5l7.5-3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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

// Framed screen with a play triangle — recorded videos
function VideoIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.5 7.2v5.6l4.6-2.8-4.6-2.8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

// Speech bubble with text lines — annotation tasks raised for videos
function AnnotationIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <path d="M3.5 4.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-3.5 3v-3a2 2 0 0 1-2-2v-7z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M6.5 6.5h7M6.5 9.5h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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

// Person with a "+" — account requests waiting for approval
function RequestsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <circle cx="8" cy="6.5" r="2.7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.8 16.5c0-2.8 2.3-4.5 5.2-4.5 1.2 0 2.3.3 3.2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M15 11v5M12.5 13.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// Clipboard with lines — job requests waiting for review
function JobRequestsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="3.5" width="12" height="14" rx="1.8" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7.5 3.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7 9h6M7 12h6M7 15h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// Video camera — recorder accounts
function RecorderIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <rect x="2.5" y="5.5" width="10" height="9" rx="1.8" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12.5 9l5-2.8v7.6l-5-2.8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

// Lab flask — researcher accounts
function ResearcherIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" className={className} aria-hidden="true">
      <path d="M8 2.8h4M9 2.8v5.4l-4.4 7.2a1.4 1.4 0 0 0 1.2 2.1h8.4a1.4 1.4 0 0 0 1.2-2.1L11 8.2V2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.8 12.8h6.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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