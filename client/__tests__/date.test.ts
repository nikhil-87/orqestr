import { describe, it, expect } from "vitest";
import { formatDateTime, formatDate, formatTime, formatRelativeTime, pad2 } from "../lib/utils/date";

describe("Date Utilities - Zero-Padded & Tabular Width Guarantee", () => {
  it("pads single digit numbers with leading zeros", () => {
    expect(pad2(0)).toBe("00");
    expect(pad2(2)).toBe("02");
    expect(pad2(9)).toBe("09");
    expect(pad2(12)).toBe("12");
  });

  it("formats datetime with strict zero-padding on single digit hours, months, days, minutes, seconds", () => {
    // 2026-08-26 at 14:50:31 (2:50:31 PM)
    const d1 = new Date(2026, 7, 26, 14, 50, 31);
    const result1 = formatDateTime(d1);
    // Month: 08, Day: 26, Year: 2026, Hours: 02, Minutes: 50, Seconds: 31 PM
    expect(result1).toBe("08/26/2026, 02:50:31 PM");

    // Morning hour: 9:05:03 AM
    const d2 = new Date(2026, 0, 5, 9, 5, 3);
    const result2 = formatDateTime(d2);
    expect(result2).toBe("01/05/2026, 09:05:03 AM");

    // Midnight: 12:00:00 AM
    const d3 = new Date(2026, 11, 31, 0, 0, 0);
    const result3 = formatDateTime(d3);
    expect(result3).toBe("12/31/2026, 12:00:00 AM");

    // Noon: 12:00:00 PM
    const d4 = new Date(2026, 5, 15, 12, 0, 0);
    const result4 = formatDateTime(d4);
    expect(result4).toBe("06/15/2026, 12:00:00 PM");
  });

  it("ensures every datetime output has the exact same character length (23 characters)", () => {
    const dates = [
      new Date(2026, 0, 1, 1, 1, 1),
      new Date(2026, 11, 31, 23, 59, 59),
      new Date(2026, 7, 26, 14, 50, 31),
      new Date(2026, 4, 9, 7, 8, 9),
    ];

    for (const d of dates) {
      const formatted = formatDateTime(d);
      expect(formatted.length).toBe(23);
    }
  });

  it("formats date with strict zero padding (MM/DD/YYYY)", () => {
    const d = new Date(2026, 3, 7); // April 7, 2026
    expect(formatDate(d)).toBe("04/07/2026");
  });

  it("formats time with strict zero padding (hh:mm:ss A)", () => {
    const d = new Date(2026, 0, 1, 3, 4, 5); // 03:04:05 AM
    expect(formatTime(d)).toBe("03:04:05 AM");
  });

  it("handles null, undefined, or invalid date inputs gracefully", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("Invalid date");
    expect(formatDate(null)).toBe("—");
    expect(formatTime(null)).toBe("—");
  });

  it("formats relative time with zero padding for minutes and hours", () => {
    const now = Date.now();
    expect(formatRelativeTime(new Date(now - 10000))).toBe("just now");
    expect(formatRelativeTime(new Date(now - 120000))).toBe("02m ago");
    expect(formatRelativeTime(new Date(now - 7200000))).toBe("02h ago");
    expect(formatRelativeTime(new Date(now - 172800000))).toBe("02d ago");
  });
});
