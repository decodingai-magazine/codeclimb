import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodeClimb",
  description: "Prepare, watch, stop and export CodeClimb nights.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <a className="brand" href="/">CodeClimb</a>
          <a href="/">Nights</a>
          <a href="/new">New run</a>
        </header>
        {children}
      </body>
    </html>
  );
}
