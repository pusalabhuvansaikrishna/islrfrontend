"use client";

// src/components/dashboard/EmailReportForm.tsx
//
// Email panel for TodaysReportModal: a chip-style email input plus a Send
// button. Pass it the SAME filters the modal used to load the report; the
// backend rebuilds the report from them.

import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import styles from "./EmailReportForm.module.css";
import { emailJobProgress } from "@/lib/api/jobProgress";

const MAX_RECIPIENTS = 10;
const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

interface EmailReportFormProps {
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  jobId?: string;
  tz?: string;
  onClose?: () => void;
}

export default function EmailReportForm({
  startDate,
  endDate,
  jobId,
  tz,
  onClose,
}: EmailReportFormProps) {
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  /**
   * Parses `text` (separated by commas, semicolons or whitespace) and adds
   * valid addresses as chips. Returns the new list, or null if anything
   * was invalid / over the limit (invalid text stays in the input).
   */
  function addFromText(text: string): string[] | null {
    const tokens = text.split(/[\s,;]+/).filter(Boolean);
    const next = [...emails];
    const invalid: string[] = [];

    for (const token of tokens) {
      if (!EMAIL_RE.test(token)) {
        invalid.push(token);
      } else if (!next.some((e) => e.toLowerCase() === token.toLowerCase())) {
        next.push(token);
      }
    }

    if (next.length > MAX_RECIPIENTS) {
      setError(`You can send to at most ${MAX_RECIPIENTS} addresses at a time.`);
      return null;
    }

    setEmails(next);
    setDraft(invalid.join(" "));
    if (invalid.length) {
      setError(`Not a valid email address: ${invalid.join(", ")}`);
      return null;
    }
    setError(null);
    return next;
  }

  function removeEmail(email: string) {
    setEmails((prev) => prev.filter((e) => e !== email));
    setError(null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === ";" || e.key === " ") {
      if (draft.trim()) {
        e.preventDefault();
        addFromText(draft);
      } else if (e.key === "Enter") {
        e.preventDefault();
        void handleSend();
      }
    } else if (e.key === "Backspace" && !draft && emails.length) {
      setEmails((prev) => prev.slice(0, -1));
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (/[\s,;]/.test(pasted.trim())) {
      e.preventDefault();
      addFromText(`${draft} ${pasted}`);
    }
  }

  async function handleSend() {
    if (sending) return;
    setSuccess(null);

    // Include anything typed but not yet turned into a chip.
    const list = draft.trim() ? addFromText(draft) : emails;
    if (!list) return;
    if (list.length === 0) {
      setError("Add at least one email address.");
      return;
    }

    setSending(true);
    setError(null);
    try {
      const res = await emailJobProgress({
        recipients: list,
        startDate,
        endDate,
        jobId,
        tz,
      });
      setSuccess(`Report sent to ${res.sent_to.join(", ")}.`);
      setEmails([]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the report.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={styles.wrapper} aria-label="Email this report">
      <label className={styles.label} htmlFor="email-report-input">
        Email this report to
      </label>

      <div className={styles.row}>
        <div className={styles.field}>
          {emails.map((email) => (
            <span key={email} className={styles.chip}>
              {email}
              <button
                type="button"
                className={styles.chipRemove}
                onClick={() => removeEmail(email)}
                aria-label={`Remove ${email}`}
                disabled={sending}
              >
                ×
              </button>
            </span>
          ))}
          <input
            id="email-report-input"
            type="text"
            inputMode="email"
            autoComplete="off"
            className={styles.input}
            value={draft}
            placeholder={emails.length ? "" : "name@example.com, another@example.com"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={() => {
              if (draft.trim()) addFromText(draft);
            }}
            disabled={sending}
          />
        </div>

        <button
          type="button"
          className={styles.send}
          onClick={handleSend}
          disabled={sending}
        >
          {sending ? "Sending…" : "Send report"}
        </button>
        {onClose && (
          <button
            type="button"
            className={styles.cancel}
            onClick={onClose}
            disabled={sending}
          >
            Close
          </button>
        )}
      </div>

      <p className={styles.hint}>
        Separate addresses with a comma, space or Enter. Up to {MAX_RECIPIENTS}.
      </p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className={styles.success} role="status">
          {success}
        </p>
      )}
    </section>
  );
}