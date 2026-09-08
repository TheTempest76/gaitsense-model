import type { Metadata } from "next";
import { Dashboard } from "@/components/Dashboard";

export const metadata: Metadata = {
  title: "Your gait data — GaitSense",
  description: "Live steps, walking time, cadence, and the gait pattern indicator from your GaitSense node.",
};

// This is the real, live dashboard — wired to the actual /api/* routes and
// the SQLite database the ESP32 posts into. Unlike the landing and exercises
// pages, nothing here is mock data; the redesign only touches presentation
// (shared nav, the brand accent on chrome elements), never the data layer.
export default function DashboardPage() {
  return <Dashboard />;
}
