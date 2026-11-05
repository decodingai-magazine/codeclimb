import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import Image from "next/image";
import logoOnDark from "../codeclimb/report/assets/logo-horizontal-light.png";
import logoOnLight from "../codeclimb/report/assets/logo-horizontal-dark.png";
import "./globals.css";
import { ThemeToggle } from "./ui";

const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "CodeClimb",
  description: "Prepare, watch, stop and export CodeClimb nights.",
};

// Applies a stored light/dark pick before the first paint, so a dark pick never flashes light.
const THEME_SCRIPT = `try{var t=localStorage.getItem("cc-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jetbrainsMono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <header className="top">
          <div className="top-inner">
            <a className="brand" href="/">
              <Image className="logo logo-light" src={logoOnLight} alt="Decoding AI" priority />
              <Image className="logo logo-dark" src={logoOnDark} alt="Decoding AI" priority />
              <span className="top-title">CodeClimb</span>
            </a>
            <span className="spacer" />
            <ThemeToggle />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
