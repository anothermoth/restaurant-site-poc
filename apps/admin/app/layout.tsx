import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/inter/wght.css";
import "@fontsource/instrument-serif/latin-400.css";
import "./globals.css";
import { SiteAnalytics } from "../components/SiteAnalytics.tsx";

export const metadata: Metadata = {
  title: "Site editor · Ember & Elm Kitchen (demo)",
  description: "Voice-driven, owner-approved edits to a restaurant website.",
  openGraph: {
    title: "Restaurant site editor (demo)",
    description: "Say or type a change to a restaurant's menu, check it, approve it, publish it.",
    type: "website",
  },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <SiteAnalytics />
      </body>
    </html>
  );
}
