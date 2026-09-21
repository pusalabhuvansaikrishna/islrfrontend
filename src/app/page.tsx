"use client";

import { useState, type FormEvent } from "react";
import styles from "./page.module.css";
import ThemeToggle from "@/components/ThemeToggle";
import { BASE_URL } from "@/config/api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    if (!username.trim() || !password.trim()) {
      setError("Please enter both username and password.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${BASE_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await response.json();

      if (!response.ok) {
        const detail = data.detail;
        if (typeof detail === "string") {
          setError(detail);
        } else if (Array.isArray(detail)) {
          setError(detail.map((d: { msg: string }) => d.msg).join(", "));
        } else {
          setError("Invalid credentials. Please try again.");
        }
        return;
      }

      document.cookie = "has_session=true; path=/; SameSite=Lax";
      window.location.href = "/dashboard";
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brandGroup}>
          <div className={styles.logoWrap} aria-hidden="true">
            <SignMarkIcon />
          </div>
          <h1 className={styles.portalTitle}>ISLR DATA CAPTURE</h1>
        </div>

        <ThemeToggle />
      </header>

      <main className={styles.main}>
        <div className={styles.illustrationWrap} aria-hidden="true">
          <CaptureIllustration />
        </div>

        <div className={styles.cardWrap}>
          <div className={styles.card}>
            <form onSubmit={handleLogin} noValidate>
              <div className={styles.fieldGroup}>
                <label htmlFor="username" className={styles.label}>
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={styles.input}
                  spellCheck={false}
                />
              </div>

              <div className={styles.fieldGroup}>
                <label htmlFor="password" className={styles.label}>
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={styles.input}
                />
              </div>

              {error && <p className={styles.error}>{error}</p>}

              <div className={styles.btnWrap}>
                <button
                  type="submit"
                  className={styles.loginBtn}
                  disabled={loading}
                >
                  {loading ? <span className={styles.spinner} /> : "Login"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}

/* Inline marks so the page has no dependency on image assets that may not
   exist yet in the project. Swap these for <Image> + real files anytime. */

function SignMarkIcon() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" fill="none">
      <path
        d="M14 26V13a3 3 0 0 1 6 0v9M20 22v-4a3 3 0 0 1 6 0v4M26 22.5v-2a3 3 0 0 1 6 0V24M32 24v-1a2.6 2.6 0 0 1 5.2 0v9.2c0 5.5-4.3 10.8-11.4 10.8h-2.2C16.8 43 12 38 12 32.6V27l-3.4-3.6a2.4 2.4 0 0 1 3.3-3.5L14 22"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CaptureIllustration() {
  return (
    <svg viewBox="0 0 320 260" width="100%" height="100%" fill="none">
      <rect x="18" y="24" width="284" height="184" rx="14" className={styles.illoFrame} />
      <rect x="34" y="42" width="252" height="148" rx="8" className={styles.illoScreen} />
      <circle cx="160" cy="116" r="34" className={styles.illoAccent} />
      <path
        d="M144 122v-16a4 4 0 0 1 8 0v12M152 118v-5a4 4 0 0 1 8 0v5M160 118.5v-3a4 4 0 0 1 8 0v4M168 119.5v-1.2a3.4 3.4 0 0 1 6.8 0v11.7c0 7-5.4 13.7-14.4 13.7h-2.7C149.1 144 143 137.5 143 130.4v-7l-4.3-4.5a3 3 0 0 1 4.2-4.4l4.1 3.7"
        stroke="var(--surface)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="252" cy="60" r="6" className={styles.illoDot} />
      <circle cx="268" cy="60" r="6" className={styles.illoDotFaint} />
      <rect x="60" y="170" width="60" height="8" rx="4" className={styles.illoBar} />
      <rect x="60" y="184" width="100" height="8" rx="4" className={styles.illoBarFaint} />
    </svg>
  );
}