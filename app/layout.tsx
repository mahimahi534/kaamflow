import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KAAMFLOW | Repair Operations & Outcome Intelligence",
  description:
    "Repair operations dashboard for appliance and electronics service businesses.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className="h-full antialiased"
    >
      <body className="min-h-full bg-slate-100 text-slate-900">{children}</body>
    </html>
  );
}
