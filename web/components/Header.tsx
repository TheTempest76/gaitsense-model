"use client";

import { motion } from "framer-motion";
import { Pill } from "./ui/Pill";
import { fmtAgo } from "@/lib/chart-utils";
import type { DeviceInfo } from "@/lib/types";

// Branding and the theme toggle live in the shared SiteNav now (rendered
// once in the root layout); this header is page-specific content only —
// title plus live device status — so it doesn't duplicate either.
export function Header({ devices }: { devices: DeviceInfo[] | null }) {
  const primary = devices?.find((d) => d.online) ?? devices?.[0] ?? null;
  const simulated = !!devices?.length && devices.every((d) => d.is_sim);

  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mb-2 flex flex-wrap items-center justify-between gap-3"
    >
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Your gait data</h1>
        <p className="mt-0.5 text-[13px] text-ink-secondary">
          {simulated
            ? "Demo data — a simulated device, not real hardware"
            : "Live readings from your ESP32 lower-back node"}
        </p>
      </div>
      <Pill
        tone={
          primary ? (primary.is_sim ? "neutral" : primary.online ? "good" : "offline") : "neutral"
        }
      >
        {primary
          ? `${primary.device_id}${primary.is_sim ? " · simulated" : ""} · ${
              primary.online ? "online" : `last seen ${fmtAgo(primary.last_seen_ms)}`
            }`
          : "No device yet"}
      </Pill>
    </motion.header>
  );
}
