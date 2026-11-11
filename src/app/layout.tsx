import type { Metadata } from "next";
import { Inter } from "next/font/google";
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
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
