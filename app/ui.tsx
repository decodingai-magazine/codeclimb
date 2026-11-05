"use client";
// Shared pieces of the app shell and pages: icons, the theme toggle, the nav, KPI tiles and meters.
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const ICONS = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>
  ),
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  stop: <rect width="14" height="14" x="5" y="5" rx="2" />,
  play: <path d="m7 4 12 8-12 8z" />,
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

const THEME_KEY = "cc-theme";

/** Light / dark switch. An explicit pick is stored; without one the OS setting applies (see the head script in layout). */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const t = document.documentElement.getAttribute("data-theme");
      setDark(t ? t === "dark" : mq.matches);
    };
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage blocked: the pick lasts for this page view.
    }
    setDark(!dark);
  };
  return (
    <button className="icon-btn" type="button" onClick={flip} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title="Theme">
      <Icon name={dark ? "sun" : "moon"} />
    </button>
  );
}

export function Nav() {
  const path = usePathname();
  const nightsActive = path === "/" || path.startsWith("/nights");
  return (
    <nav className="nav" aria-label="Main">
      <a href="/" aria-current={nightsActive ? "page" : undefined}>Nights</a>
    </nav>
  );
}

export function Kpi({ label, value, note, children }: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {children}
      {note != null && <div className="note">{note}</div>}
    </div>
  );
}

/** A progress meter: spend against budget, time against deadline. Turns red past the limit. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`meter${value > max ? " over" : ""}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = { running: "running", finished: "finished", stopped: "stopped", stale: "stale" };

/** A night's status: live while running, accented when it met its thresholds, plain otherwise. */
export function StatusBadge({ status, stopReason }: { status: string; stopReason: string | null }) {
  if (status === "running") return <span className="badge live">running</span>;
  const text = status === "finished" && stopReason ? `finished · ${stopReason}` : STATUS_LABEL[status] ?? status;
  return <span className={`badge${stopReason === "thresholds" ? " hot" : ""}`}>{text}</span>;
}
