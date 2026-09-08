"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardHeading } from "./ui/Card";
import { Button } from "./ui/Button";
import { BellIcon, PersonIcon } from "./icons";
import {
  getAlertLog,
  getCaregiverContact,
  saveCaregiverContact,
  sendAlert,
  type AlertLogEntry,
  type CaregiverContact,
} from "@/lib/caregiver";

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CaregiverAlertCard() {
  // Both start unresolved (not "empty") until after mount, same reasoning as
  // ThemeToggle/StreakStrip: localStorage doesn't exist during SSR, and
  // rendering the "no caregiver saved" form on the server would flash into
  // the real saved-contact view a moment later for anyone who has one.
  const [contact, setContact] = useState<CaregiverContact | null | undefined>(undefined);
  const [log, setLog] = useState<AlertLogEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", relation: "" });

  useEffect(() => {
    const saved = getCaregiverContact();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContact(saved);
    setLog(getAlertLog());
    if (saved) setForm(saved);
  }, []);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return;
    saveCaregiverContact(form);
    setContact(form);
    setEditing(false);
  }

  function handleSend() {
    if (!contact) return;
    const updated = sendAlert(
      `Manual check-in requested for ${contact.name} from the GaitSense dashboard.`
    );
    setLog(updated);
    setJustSent(true);
    setTimeout(() => setJustSent(false), 2500);
  }

  if (contact === undefined) {
    return (
      <Card delay={0.08}>
        <div className="h-24" />
      </Card>
    );
  }

  return (
    <Card delay={0.08}>
      <CardHeading
        title="Caregiver alert"
        hint="A quick way to check in with someone if you'd like a second opinion on how you're doing."
      />

      <AnimatePresence mode="wait">
        {!contact || editing ? (
          <motion.form
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onSubmit={handleSave}
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            <label className="text-[13px] text-ink-secondary">
              Name
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Jordan Lee"
                className="mt-1 h-11 w-full rounded-lg border border-hairline-border bg-page px-3 text-[14.5px] text-ink outline-none focus-visible:border-accent"
              />
            </label>
            <label className="text-[13px] text-ink-secondary">
              Phone
              <input
                required
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="(555) 555-0100"
                className="mt-1 h-11 w-full rounded-lg border border-hairline-border bg-page px-3 text-[14.5px] text-ink outline-none focus-visible:border-accent"
              />
            </label>
            <label className="text-[13px] text-ink-secondary">
              Relation (optional)
              <input
                value={form.relation}
                onChange={(e) => setForm({ ...form, relation: e.target.value })}
                placeholder="Daughter"
                className="mt-1 h-11 w-full rounded-lg border border-hairline-border bg-page px-3 text-[14.5px] text-ink outline-none focus-visible:border-accent"
              />
            </label>
            <div className="flex items-end gap-2 sm:col-span-3">
              <Button type="submit" variant="primary">
                Save caregiver
              </Button>
              {contact && (
                <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </motion.form>
        ) : (
          <motion.div key="saved" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-accent-wash text-accent">
                  <PersonIcon className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-[14.5px] font-semibold">{contact.name}</div>
                  <div className="text-[12.5px] text-ink-secondary">
                    {contact.relation ? `${contact.relation} · ` : ""}
                    {contact.phone}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[13px] font-medium text-ink-secondary hover:text-ink"
              >
                Edit
              </button>
            </div>

            <Button variant="primary" size="lg" className="mt-5 w-full sm:w-auto" onClick={handleSend}>
              <BellIcon className="h-5 w-5" />
              {justSent ? "Alert logged" : "Alert my caregiver now"}
            </Button>
            <p className="mt-2 text-[12px] text-ink-muted">
              Demo only — this records a local entry below and does not send a real
              text, call, or email.
            </p>

            {log.length > 0 && (
              <div className="mt-5 border-t border-hairline pt-4">
                <div className="text-[12.5px] font-medium text-ink-secondary">Alert log</div>
                <ul className="mt-2 space-y-1.5">
                  {log.slice(0, 5).map((entry) => (
                    <li
                      key={entry.ts_ms}
                      className="flex items-baseline gap-2.5 text-[13px] text-ink-secondary"
                    >
                      <span className="tabular-nums text-ink-muted">{fmtTime(entry.ts_ms)}</span>
                      <span className="text-ink">{entry.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
