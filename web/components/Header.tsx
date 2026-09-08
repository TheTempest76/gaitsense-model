"use client";

import { motion } from "framer-motion";
import { Pill } from "./ui/Pill";
import { ThemeToggle } from "./ui/ThemeToggle";
import { fmtAgo } from "@/lib/chart-utils";
import type { DeviceInfo } from "@/lib/types";

export function Header({ devices }: { devices: DeviceInfo[] | null }) {
  const primary = devices?.find((d) => d.online) ?? devices?.[0] ?? null;

  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mb-2 flex flex-wrap items-center justify-between gap-3"
    >
      <div>
        <h1 className="text-xl font-semibold tracking-tight">GaitSense</h1>
        <p className="mt-0.5 text-[13px] text-ink-secondary">
          Gait monitoring from the ESP32 lower-back node
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Pill tone={primary ? (primary.online ? "good" : "offline") : "neutral"}>
          {primary
            ? primary.online
              ? `${primary.device_id} · online`
              : `${primary.device_id} · last seen ${fmtAgo(primary.last_seen_ms)}`
            : "No device yet"}
        </Pill>
        <ThemeToggle />
      </div>
    </motion.header>
  );
}
