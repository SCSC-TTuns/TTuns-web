(() => {
  const frame = document.getElementById("ttuns-widget-frame");
  if (!frame) return;

  const BRIDGE_TYPE = "ttuns:tool-context";
  const READY_TYPE = "ttuns:widget:ready";
  const UI_INITIALIZED_METHOD = "ui/notifications/initialized";

  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const isRecord = (value) => typeof value === "object" && value !== null;
  const currentGlobals = () => (isRecord(window.openai) ? window.openai : {});

  const TOOL_OUTPUT_WRAPPER_KEYS = ["toolResult", "toolOutput", "result", "output"];

  const extractToolOutput = (payload) => {
    const queue = [payload];
    const seen = new Set();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!isRecord(current)) continue;
      if (seen.has(current)) continue;
      seen.add(current);

      if (hasOwn(current, "structuredContent")) return current.structuredContent;

      for (const key of TOOL_OUTPUT_WRAPPER_KEYS) {
        if (hasOwn(current, key)) queue.push(current[key]);
      }
    }

    return undefined;
  };

  const normalizeToolOutput = (payload) => {
    const structured = extractToolOutput(payload);
    if (structured !== undefined) return structured;
    return payload ?? null;
  };

  let latestToolOutput = normalizeToolOutput(currentGlobals().toolOutput);
  let latestToolInput = currentGlobals().toolInput ?? null;
  let hostInitialized = false;

  const notifyHostInitialized = () => {
    if (hostInitialized) return;
    if (!window.parent || window.parent === window) return;
    window.parent.postMessage(
      {
        jsonrpc: "2.0",
        method: UI_INITIALIZED_METHOD,
        params: {},
      },
      "*"
    );
    hostInitialized = true;
  };

  const publishToChild = () => {
    if (!frame.contentWindow) return;
    frame.contentWindow.postMessage(
      {
        type: BRIDGE_TYPE,
        toolOutput: latestToolOutput,
        toolInput: latestToolInput,
      },
      "*"
    );
  };

  const extractToolInput = (payload) => {
    if (!isRecord(payload)) return undefined;
    if (hasOwn(payload, "toolInput")) return payload.toolInput;
    if (hasOwn(payload, "input")) return payload.input;
    if (hasOwn(payload, "arguments")) return payload.arguments;
    return undefined;
  };

  const applyNotification = (message) => {
    if (!isRecord(message)) return false;

    if (message.type === BRIDGE_TYPE) {
      let changed = false;
      if (hasOwn(message, "toolOutput")) {
        latestToolOutput = normalizeToolOutput(message.toolOutput);
        changed = true;
      }
      if (hasOwn(message, "toolInput")) {
        latestToolInput = message.toolInput ?? null;
        changed = true;
      }
      return changed;
    }

    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return false;
    }

    if (message.method === "ui/notifications/tool-result") {
      latestToolOutput = normalizeToolOutput(message.params);
      return true;
    }

    if (message.method === "ui/notifications/tool-input") {
      const nextInput = extractToolInput(message.params);
      if (nextInput !== undefined) {
        latestToolInput = nextInput ?? null;
        return true;
      }
    }

    return false;
  };

  frame.addEventListener("load", () => publishToChild(), { passive: true });

  window.addEventListener(
    "openai:set_globals",
    (event) => {
      const globals = isRecord(event?.detail) ? event.detail.globals : undefined;
      if (isRecord(globals)) {
        if (hasOwn(globals, "toolOutput")) {
          latestToolOutput = normalizeToolOutput(globals.toolOutput);
        }
        if (hasOwn(globals, "toolInput")) latestToolInput = globals.toolInput ?? null;
      } else {
        const snapshot = currentGlobals();
        if (hasOwn(snapshot, "toolOutput")) {
          latestToolOutput = normalizeToolOutput(snapshot.toolOutput);
        }
        latestToolInput = snapshot.toolInput ?? latestToolInput;
      }
      publishToChild();
    },
    { passive: true }
  );

  window.addEventListener(
    "message",
    (event) => {
      if (event.source === frame.contentWindow) {
        if (!isRecord(event.data) || event.data.type !== READY_TYPE) return;
        notifyHostInitialized();
        publishToChild();
        return;
      }
      if (!applyNotification(event.data)) return;
      publishToChild();
    },
    { passive: true }
  );

  notifyHostInitialized();
  publishToChild();
})();
