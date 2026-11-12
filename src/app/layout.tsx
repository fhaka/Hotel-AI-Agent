import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { connection } from "next/server";
import { Suspense } from "react";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "HotelAI — AI agents for hotels and guesthouses",
    template: "%s · HotelAI",
  },
  description:
    "HotelAI gives hotels and service businesses AI receptionists and reservation assistants that answer guests from your real information and book against real availability.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        {children}
        {/* A request-time hole on every page: Next.js then streams the page data
            at request time with the CSP nonce instead of baking it into a
            static HTML file (see ADR 0012). Renders nothing. */}
        <Suspense fallback={null}>
          <RequestTime />
        </Suspense>
      </body>
    </html>
  );
}

async function RequestTime() {
  await connection();
  return null;
}
