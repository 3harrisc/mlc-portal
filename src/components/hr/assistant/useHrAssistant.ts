"use client";

import { useCallback, useRef, useState } from "react";
import type { AssistantMode } from "@/lib/hr/assistant/notes";

export interface AssistantRequest {
  mode: AssistantMode;
  request: string;
  currentDraft?: string;
  documentId?: string;
}

type StreamEvent =
  | { t: "status"; m: string }
  | { t: "text"; d: string }
  | { t: "warn"; m: string }
  | { t: "error"; m: string }
  | { t: "done" };

/** Runs one assistant request and exposes its streamed output. */
export function useHrAssistant() {
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (body: AssistantRequest): Promise<string> => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setOutput("");
    setWarning(null);
    setError(null);
    setStatus("Starting…");
    setRunning(true);
    let text = "";
    try {
      const res = await fetch("/api/hr/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as StreamEvent;
          if (ev.t === "text") {
            text += ev.d;
            setOutput(text);
          } else if (ev.t === "status") setStatus(ev.m);
          else if (ev.t === "warn") setWarning(ev.m);
          else if (ev.t === "error") setError(ev.m);
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === abort) {
        setRunning(false);
        setStatus(null);
      }
    }
    return text;
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
    setStatus(null);
  }, []);

  return { output, status, warning, error, running, run, stop };
}
