"use client";

import { useEffect, useState } from "react";
import { formatDate, formatDateTime, formatTime, formatRelativeTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

type FormattedDateProps = {
  date: string | number | Date;
  format?: "date" | "datetime" | "time" | "relative";
  className?: string;
};

export default function FormattedDate({
  date,
  format = "date",
  className,
}: FormattedDateProps) {
  const [formatted, setFormatted] = useState<string>("");

  useEffect(() => {
    try {
      if (format === "date") {
        setFormatted(formatDate(date));
      } else if (format === "datetime") {
        setFormatted(formatDateTime(date));
      } else if (format === "time") {
        setFormatted(formatTime(date));
      } else if (format === "relative") {
        setFormatted(formatRelativeTime(date));
      }
    } catch {
      setFormatted("");
    }
  }, [date, format]);

  if (!formatted) {
    return (
      <span className={cn("font-mono tabular-nums", className)} suppressHydrationWarning>
        {formatDate(date)}
      </span>
    );
  }

  return <span className={cn("font-mono tabular-nums", className)}>{formatted}</span>;
}
