"use client";

import { useSyncExternalStore } from "react";

type OpenAiBridge = {
  toolOutput?: unknown;
  toolInput?: unknown;
};

declare global {
  interface Window {
    openai?: OpenAiBridge;
  }
}

let bridgedToolOutput: unknown = null;

function readBridgedToolOutput() {
  return normalizeToolOutput(bridgedToolOutput);
}

function readToolOutput() {
  if (typeof window === "undefined") return null;
  if (window.openai && "toolOutput" in window.openai) {
    return normalizeToolOutput(window.openai.toolOutput) ?? null;
  }
  return readBridgedToolOutput() ?? null;
}

function isBridgePayload(value: unknown): value is { type: string; toolOutput?: unknown } {
  return typeof value === "object" && value !== null && "type" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const TOOL_OUTPUT_WRAPPER_KEYS = ["toolResult", "toolOutput", "result", "output"] as const;

function extractStructuredContent(payload: unknown): unknown {
  const queue: unknown[] = [payload];
  const seen = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!isRecord(current)) continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if ("structuredContent" in current) return current.structuredContent;
    for (const key of TOOL_OUTPUT_WRAPPER_KEYS) {
      if (key in current) queue.push(current[key]);
    }
  }

  return undefined;
}

function normalizeToolOutput(payload: unknown): unknown {
  const structured = extractStructuredContent(payload);
  if (structured !== undefined) return structured;
  return payload;
}

function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => {};

  let previous = readToolOutput();
  const notifyIfChanged = () => {
    const next = readToolOutput();
    if (!Object.is(previous, next)) {
      previous = next;
      callback();
    }
  };

  const onSetGlobals = () => notifyIfChanged();
  const onBridgeMessage = (event: MessageEvent) => {
    if (!isBridgePayload(event.data)) return;
    if (event.data.type !== "ttuns:tool-context") return;
    bridgedToolOutput = normalizeToolOutput(event.data.toolOutput ?? null);
    notifyIfChanged();
  };
  const onMcpBridgeMessage = (event: MessageEvent) => {
    if (!isRecord(event.data)) return;
    if (event.data.jsonrpc !== "2.0") return;
    if (event.data.method !== "ui/notifications/tool-result") return;
    bridgedToolOutput = normalizeToolOutput(event.data.params);
    notifyIfChanged();
  };

  window.addEventListener("openai:set_globals", onSetGlobals as EventListener);
  document.addEventListener("openai:set_globals", onSetGlobals as EventListener);
  window.addEventListener("message", onBridgeMessage);
  window.addEventListener("message", onMcpBridgeMessage);

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "ttuns:widget:ready" }, "*");
  }

  const intervalId = window.setInterval(notifyIfChanged, 250);

  return () => {
    window.removeEventListener("openai:set_globals", onSetGlobals as EventListener);
    document.removeEventListener("openai:set_globals", onSetGlobals as EventListener);
    window.removeEventListener("message", onBridgeMessage);
    window.removeEventListener("message", onMcpBridgeMessage);
    window.clearInterval(intervalId);
  };
}

export function useWidgetToolOutput<T>() {
  return useSyncExternalStore(
    subscribe,
    () => readToolOutput() as T | null,
    () => null
  );
}
