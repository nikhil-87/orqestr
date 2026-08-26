/**
 * Standardized date & time formatting utilities for Orqestr.
 * Enforces zero-padded, fixed-width timestamps ("MM/DD/YYYY, hh:mm:ss A")
 * to ensure perfect tabular alignment across all tables, cards, and feeds.
 */

export const pad2 = (num: number): string => num.toString().padStart(2, "0");

/**
 * Strict, zero-padded datetime string:
 * e.g. "08/26/2026, 02:50:31 PM"
 */
export const formatDateTime = (input?: string | number | Date | null): string => {
  if (!input) return "—";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "Invalid date";

  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const year = d.getFullYear();

  let hours = d.getHours();
  const period = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const minutes = pad2(d.getMinutes());
  const seconds = pad2(d.getSeconds());

  return `${month}/${day}/${year}, ${pad2(hours)}:${minutes}:${seconds} ${period}`;
};

/**
 * Strict, zero-padded date string:
 * e.g. "08/26/2026"
 */
export const formatDate = (input?: string | number | Date | null): string => {
  if (!input) return "—";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "Invalid date";

  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const year = d.getFullYear();

  return `${month}/${day}/${year}`;
};

/**
 * Strict, zero-padded time string:
 * e.g. "02:50:31 PM"
 */
export const formatTime = (input?: string | number | Date | null): string => {
  if (!input) return "—";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "Invalid date";

  let hours = d.getHours();
  const period = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const minutes = pad2(d.getMinutes());
  const seconds = pad2(d.getSeconds());

  return `${pad2(hours)}:${minutes}:${seconds} ${period}`;
};

/**
 * Clean relative time with zero-padded metrics:
 * e.g. "just now", "05m ago", "02h ago", "03d ago"
 */
export const formatRelativeTime = (input?: string | number | Date | null): string => {
  if (!input) return "—";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "Invalid date";

  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 45) return "just now";
  if (diffSec < 3600) return `${pad2(Math.floor(diffSec / 60))}m ago`;
  if (diffSec < 86400) return `${pad2(Math.floor(diffSec / 3600))}h ago`;
  return `${pad2(Math.floor(diffSec / 86400))}d ago`;
};
