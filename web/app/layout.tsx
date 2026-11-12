import type { Metadata } from "next";
import "./globals.css";
import { ThemeToggle } from "./ui";

export const metadata: Metadata = {
  title: "CodeClimb",
  description: "Watch, stop, continue and export CodeClimb nights.",
};

// Applies a stored light/dark pick before the first paint, so a dark pick never flashes light.
const THEME_SCRIPT = `try{var t=localStorage.getItem("cc-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <header className="top">
          <div className="top-inner">
            <a className="brand" href="/">
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
