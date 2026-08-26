import { useEffect, useState } from "react";

type RunEvent = {
  taskId?: string;
  status?: string;
  output?: unknown;
  type?: string;
  runId?: string;
  error?: string;
};

export const useRunStream = (runId: string) => {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!runId) return;

    setEvents([]);
    setConnected(false);

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
    const streamUrl = token
      ? `${apiUrl}/api/runs/${runId}/stream?token=${encodeURIComponent(token)}`
      : `${apiUrl}/api/runs/${runId}/stream`;

    const eventSource = new EventSource(streamUrl, { withCredentials: true });

    eventSource.addEventListener("connected", () => {
      setConnected(true);
    });

    eventSource.addEventListener("workflow-update", (e) => {
      try {
        const data = JSON.parse(e.data) as RunEvent;
        setEvents((prev) => [...prev, data]);
      } catch {
        // Silently ignore non-JSON or heartbeat events
      }
    });

    eventSource.onerror = () => {
      if (eventSource.readyState === EventSource.CLOSED) {
        setConnected(false);
      }
    };

    return () => {
      eventSource.close();
      setConnected(false);
    };
  }, [runId]);

  return { events, connected };
};
