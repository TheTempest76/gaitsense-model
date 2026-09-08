import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "GaitSense",
  description: "Gait monitoring dashboard for the ESP32 GaitSense wearable.",
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
      <body className="min-h-full font-sans antialiased bg-page text-ink">{children}</body>
    </html>
  );
}
