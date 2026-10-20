import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { themeBootstrapScript } from "@/features/theme-bootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: "RailScore",
  description:
    "How often a direct train between two stations has arrived on time. Journeys with a change are not included.",
};

/** Lets the layout shrink with the keyboard so focused fields stay in view. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
