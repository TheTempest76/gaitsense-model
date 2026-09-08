"use client";

/**
 * Client-only caregiver contact + alert log, backed by localStorage —
 * consistent with the rest of this prototype's "mock data, no backend" rule
 * (see lib/streaks.ts for the same pattern).
 *
 * Important: there is no SMS/email/push integration wired up anywhere in
 * this app. "Sending an alert" here means recording an entry in this local
 * log, nothing more — no message leaves the browser. The UI that calls
 * `sendAlert` is responsible for saying so; don't repurpose this to imply a
 * real caregiver was actually contacted.
 */

const CONTACT_KEY = "gaitsense-caregiver-contact";
const LOG_KEY = "gaitsense-alert-log";
const MAX_LOG_ENTRIES = 20;

export interface CaregiverContact {
  name: string;
  phone: string;
  relation: string;
}

export interface AlertLogEntry {
  ts_ms: number;
  message: string;
}

export function getCaregiverContact(): CaregiverContact | null {
  try {
    const raw = localStorage.getItem(CONTACT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.name === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCaregiverContact(contact: CaregiverContact): void {
  try {
    localStorage.setItem(CONTACT_KEY, JSON.stringify(contact));
  } catch {
    /* storage blocked — the form still reflects the value for this session */
  }
}

export function clearCaregiverContact(): void {
  try {
    localStorage.removeItem(CONTACT_KEY);
  } catch {
    /* nothing to do */
  }
}

export function getAlertLog(): AlertLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Records a demo alert. Returns the updated log (newest first). */
export function sendAlert(message: string): AlertLogEntry[] {
  const log = [{ ts_ms: Date.now(), message }, ...getAlertLog()].slice(0, MAX_LOG_ENTRIES);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* storage blocked — caller still sees the entry via the returned array */
  }
  return log;
}
