import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function formatCurrency(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - d;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

/**
 * Semantic due-date signal, tuned so yellow is rare + meaningful:
 *   overdue  — past due date, not complete       → alarming red
 *   soon     — due within 24 hours               → alarming yellow
 *   later    — 1–7 days out                      → quiet neutral chip
 *   far      — more than 7 days out              → suppress chip entirely
 *   complete — the "done" state                  → quiet green
 */
export function dueState(iso: string | null | undefined, complete = false) {
  if (!iso) return "none" as const;
  if (complete) return "complete" as const;
  const now = new Date();
  const due = new Date(iso);
  const diff = due.getTime() - now.getTime();
  const days = diff / (1000 * 60 * 60 * 24);
  if (days < 0) return "overdue" as const;
  if (days < 1) return "soon" as const;
  if (days < 7) return "later" as const;
  return "far" as const;
}
