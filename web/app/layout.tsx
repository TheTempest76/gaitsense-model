import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SiteNav } from "@/components/nav/SiteNav";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "GaitSense", template: "%s" },
  description:
    "GaitSense reads how you walk from an ankle-worn sensor and turns it into a clear Mobility Score, trends over time, and exercises to help you stay steady.",
};

// Applies a saved theme choice before first paint, so switching themes does
// not flash the wrong palette on reload. Kept as a tiny inline script rather
// than a client component because a component only runs after hydration —
// too late to prevent the flash.
const THEME_INIT = `
(function () {
  try {
    var saved = localStorage.getItem("gaitsense-theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-full font-sans antialiased bg-page text-ink">
        <SiteNav />
        {/* pb clears the fixed mobile tab bar (~64px + safe-area); sm+ drops it since that bar is mobile-only */}
        <div className="pb-20 sm:pb-0">{children}</div>
      </body>
    </html>
  );
}
