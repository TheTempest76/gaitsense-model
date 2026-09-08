import { Card, CardHeading } from "./ui/Card";
import { fmtAgo, fmtInt } from "@/lib/chart-utils";
import type { DeviceInfo } from "@/lib/types";

export function DevicesPanel({ devices }: { devices: DeviceInfo[] | null }) {
  return (
    <Card delay={0.3}>
      <CardHeading
        title="Devices"
        hint="Nodes that have reported in. A node posts one reading every 5 seconds while powered."
      />
      {!devices?.length ? (
        <p className="py-2 text-[13px] text-ink-muted">
          No device has reported yet. Flash the firmware in{" "}
          <code className="rounded border border-hairline-border bg-page px-1 py-0.5 text-[11.5px]">
            firmware/
          </code>
          , set the server URL and token, and power it up.
        </p>
      ) : (
        <div>
          {devices.map((d) => (
            <div
              key={d.device_id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline py-2.5 text-[13px] last:border-b-0"
            >
              <span
                className="h-2 w-2 flex-none rounded-full"
                style={{ background: d.online ? "var(--status-good)" : "var(--text-muted)" }}
              />
              <span className="font-semibold">{d.device_id}</span>
              {d.is_sim && (
                <span className="rounded border border-hairline-border bg-page px-1.5 py-0.5 text-[11px] text-ink-muted">
                  simulated
                </span>
              )}
              <span className="tabular-nums text-ink-secondary">fw {d.fw || "?"}</span>
              <span className="tabular-nums text-ink-secondary">{fmtInt(d.total_windows)} windows</span>
              <span className="tabular-nums text-ink-secondary">RSSI {d.rssi ?? "—"} dBm</span>
              <span className="tabular-nums text-ink-secondary">
                clock: {d.ts_source === "device" ? "device (SNTP)" : "server arrival"}
              </span>
              <span className="tabular-nums text-ink-secondary">{fmtAgo(d.last_seen_ms)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
