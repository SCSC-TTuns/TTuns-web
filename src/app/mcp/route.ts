import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import {
  buildEventsFromLectures,
  lectureMatchesProfessorExact,
  lectureMatchesRoomExact,
} from "@/lib/lectureSchedule";
import { canonicalSemesterId } from "@/server/snutt";

export const runtime = "nodejs";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

type JsonRpcErrorCode = -32700 | -32600 | -32601 | -32602 | -32603;

type JsonRpcErrorObject = {
  code: JsonRpcErrorCode;
  message: string;
  data?: unknown;
};

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: JsonRpcErrorObject };

const RPC_ERRORS = {
  PARSE_ERROR: -32700 as const,
  INVALID_REQUEST: -32600 as const,
  METHOD_NOT_FOUND: -32601 as const,
  INVALID_PARAMS: -32602 as const,
  INTERNAL_ERROR: -32603 as const,
};

class RpcRequestError extends Error {
  constructor(
    public readonly code: JsonRpcErrorCode,
    message: string,
    public readonly data?: unknown
  ) {
    super(message);
  }
}

const MCP_PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = {
  name: "ttuns-mcp-server",
  version: "0.1.0",
};

const TOOL_SEARCH_TIMETABLE = "search_timetable";
const TOOL_FIND_FREE_ROOMS = "find_free_rooms";
const TOOL_FIND_NEARBY_BUILDINGS = "find_nearby_free_room_buildings";

const URI_TIMETABLE_WIDGET = "ui://widget/timetable.html";
const URI_FREE_ROOMS_WIDGET = "ui://widget/free-rooms.html";
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

type WidgetName = "timetable" | "free-rooms";
type SecurityScheme = { type: "noauth" } | { type: "oauth2"; scopes?: string[] };

const NO_AUTH_SECURITY_SCHEMES: SecurityScheme[] = [{ type: "noauth" }];

const HHMM_SCHEMA = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/);

const timetableInputSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  semester: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
  search_type: z.enum(["professor", "room"]),
  query: z.string().trim().min(1),
});

const freeRoomsInputSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  semester: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
  building: z.string().trim().min(1),
  day: z.coerce.number().int().min(0).max(6).optional(),
  at: HHMM_SCHEMA.optional(),
});

const nearbyBuildingsInputSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  semester: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
  lat: z.coerce.number().gte(-90).lte(90),
  lon: z.coerce.number().gte(-180).lte(180),
  day: z.coerce.number().int().min(0).max(6).optional(),
  at: HHMM_SCHEMA.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  radiusMeters: z.coerce.number().positive().optional(),
  format: z.enum(["buildings", "rooms"]).optional(),
});

const resourcesReadInputSchema = z.object({
  uri: z.string().trim().min(1),
});

const toolCallInputSchema = z.object({
  name: z.string().trim().min(1),
  arguments: z.unknown().optional(),
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": [
    "Content-Type",
    "Accept",
    "Authorization",
    "Mcp-Session-Id",
    "Mcp-Protocol-Version",
    "Last-Event-ID",
    "x-openai-assistant-id",
    "x-openai-tool-call-id",
  ].join(", "),
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function normalizeSemesterOrThrow(value: string | number): string {
  const canon = canonicalSemesterId(String(value));
  if (canon === "1" || canon === "2" || canon === "3" || canon === "4") {
    return canon;
  }
  throw new RpcRequestError(
    RPC_ERRORS.INVALID_PARAMS,
    "invalid semester: use 1/2/3/4 (aliases like spring, 1학기, fall are also accepted)"
  );
}

function responseWithCors(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "no-store",
    },
  });
}

function sseWithCors(data: unknown, status = 200) {
  const encoder = new TextEncoder();
  const payload = JSON.stringify(data);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`event: message\n`));
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      controller.close();
    },
  });

  return new NextResponse(stream, {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function wantsEventStream(req: NextRequest) {
  const accept = (req.headers.get("accept") ?? "").toLowerCase();
  return accept.includes("text/event-stream");
}

function sseEndpointWithCors(endpointUrl: string, status = 200) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Legacy HTTP+SSE transport compatibility: endpoint discovery event.
      controller.enqueue(encoder.encode("event: endpoint\n"));
      controller.enqueue(encoder.encode(`data: ${endpointUrl}\n\n`));
      controller.close();
    },
  });

  return new NextResponse(stream, {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function emptyWithCors(status = 204) {
  return new NextResponse(null, {
    status,
    headers: CORS_HEADERS,
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function hasId(req: JsonRpcRequest): req is JsonRpcRequest & { id: JsonRpcId } {
  return "id" in req;
}

function rpcSuccess(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(
  id: JsonRpcId,
  code: JsonRpcErrorCode,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function getOrigin(req: NextRequest): string {
  const fromEnv = process.env.MCP_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("x-original-host")?.split(",")[0]?.trim() ||
    req.headers.get("host")?.trim() ||
    "localhost:3000";
  const protoFromHeader = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isLocalHost = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(host);
  const proto = protoFromHeader || (isLocalHost ? "http" : "https");
  return `${proto}://${host}`;
}

function widgetSrc(origin: string, widget: WidgetName) {
  return `${origin}/mcp/widgets/${widget}`;
}

function buildWidgetIframeDocument(src: string, title: string) {
  const safeSrc = escapeHtmlAttr(src);
  const safeTitle = escapeHtmlAttr(title);
  const safeBridgeSrc = escapeHtmlAttr(new URL("/mcp-widget-bridge.js", src).toString());
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      html,
      body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #f8fafc;
      }
      iframe {
        border: 0;
        width: 100%;
        height: 100%;
        display: block;
        background: transparent;
      }
    </style>
  </head>
  <body>
    <iframe
      id="ttuns-widget-frame"
      src="${safeSrc}"
      title="${safeTitle}"
      referrerpolicy="origin"
    ></iframe>
    <script src="${safeBridgeSrc}"></script>
  </body>
</html>`;
}

function widgetMeta(origin: string, description: string) {
  return {
    ui: {
      prefersBorder: true,
      csp: {
        connectDomains: [origin],
        resourceDomains: [origin],
        frameDomains: [origin],
      },
      domain: origin,
    },
    "openai/widgetDescription": description,
    "openai/widgetPrefersBorder": true,
    "openai/widgetCSP": {
      connect_domains: [origin],
      resource_domains: [origin],
      frame_domains: [origin],
    },
    "openai/widgetDomain": origin,
  };
}

function toolDescriptors() {
  return [
    {
      name: TOOL_SEARCH_TIMETABLE,
      title: "시간표 검색",
      description: "교수명 또는 강의실 기준으로 시간표 이벤트를 검색합니다.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["year", "semester", "search_type", "query"],
        properties: {
          year: { type: "integer", minimum: 2000, maximum: 2100 },
          semester: {
            type: ["string", "number"],
            description:
              "학기 코드. 1=1학기(spring), 2=여름(summer), 3=2학기(fall), 4=겨울(winter).",
          },
          search_type: { type: "string", enum: ["professor", "room"] },
          query: { type: "string", minLength: 1 },
        },
      },
      annotations: {
        readOnlyHint: true,
        "openai/resultCanProduceWidget": true,
      },
      securitySchemes: NO_AUTH_SECURITY_SCHEMES,
      _meta: {
        securitySchemes: NO_AUTH_SECURITY_SCHEMES,
        ui: {
          resourceUri: URI_TIMETABLE_WIDGET,
          visibility: ["model"],
        },
        "openai/widgetAccessible": false,
        "openai/outputTemplate": URI_TIMETABLE_WIDGET,
        "openai/toolInvocation/invoking": "시간표를 조회하는 중입니다...",
        "openai/toolInvocation/invoked": "시간표 조회가 완료되었습니다.",
      },
    },
    {
      name: TOOL_FIND_FREE_ROOMS,
      title: "빈 강의실 찾기",
      description: "특정 동번호에서 현재 비어 있는 강의실과 사용 가능 종료 시각을 찾습니다.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["year", "semester", "building"],
        properties: {
          year: { type: "integer", minimum: 2000, maximum: 2100 },
          semester: {
            type: ["string", "number"],
            description:
              "학기 코드. 1=1학기(spring), 2=여름(summer), 3=2학기(fall), 4=겨울(winter).",
          },
          building: { type: "string", minLength: 1 },
          day: { type: "integer", minimum: 0, maximum: 6 },
          at: { type: "string", pattern: "^([01]?\\d|2[0-3]):[0-5]\\d$" },
        },
      },
      annotations: {
        readOnlyHint: true,
        "openai/resultCanProduceWidget": true,
      },
      securitySchemes: NO_AUTH_SECURITY_SCHEMES,
      _meta: {
        securitySchemes: NO_AUTH_SECURITY_SCHEMES,
        ui: {
          resourceUri: URI_FREE_ROOMS_WIDGET,
          visibility: ["model"],
        },
        "openai/widgetAccessible": false,
        "openai/outputTemplate": URI_FREE_ROOMS_WIDGET,
        "openai/toolInvocation/invoking": "빈 강의실을 조회하는 중입니다...",
        "openai/toolInvocation/invoked": "빈 강의실 조회가 완료되었습니다.",
      },
    },
    {
      name: TOOL_FIND_NEARBY_BUILDINGS,
      title: "내 주변 빈 강의실 동 추천",
      description:
        "사용자 위치(lat/lon) 기준으로 주변 동별 빈 강의실 정보를 거리순으로 추천합니다.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["year", "semester", "lat", "lon"],
        properties: {
          year: { type: "integer", minimum: 2000, maximum: 2100 },
          semester: {
            type: ["string", "number"],
            description:
              "학기 코드. 1=1학기(spring), 2=여름(summer), 3=2학기(fall), 4=겨울(winter).",
          },
          lat: { type: "number", minimum: -90, maximum: 90 },
          lon: { type: "number", minimum: -180, maximum: 180 },
          day: { type: "integer", minimum: 0, maximum: 6 },
          at: { type: "string", pattern: "^([01]?\\d|2[0-3]):[0-5]\\d$" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          radiusMeters: { type: "number", exclusiveMinimum: 0 },
          format: { type: "string", enum: ["buildings", "rooms"] },
        },
      },
      annotations: {
        readOnlyHint: true,
        "openai/resultCanProduceWidget": true,
      },
      securitySchemes: NO_AUTH_SECURITY_SCHEMES,
      _meta: {
        securitySchemes: NO_AUTH_SECURITY_SCHEMES,
        ui: {
          resourceUri: URI_FREE_ROOMS_WIDGET,
          visibility: ["model"],
        },
        "openai/widgetAccessible": false,
        "openai/outputTemplate": URI_FREE_ROOMS_WIDGET,
        "openai/toolInvocation/invoking": "주변 빈 강의실 건물을 찾는 중입니다...",
        "openai/toolInvocation/invoked": "주변 추천을 불러왔습니다.",
      },
    },
  ];
}

type QueryValue = string | number | undefined;
async function callSnuttApi(
  req: NextRequest,
  path: string,
  query: Record<string, QueryValue>
): Promise<unknown> {
  const origin = getOrigin(req);
  const url = new URL(path, origin);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(req.headers.get("x-forwarded-for")
        ? { "x-forwarded-for": req.headers.get("x-forwarded-for") as string }
        : {}),
    },
    cache: "no-store",
  });

  const raw = await res.text();
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = raw;
    }
  }

  if (!res.ok) {
    if (isRecord(parsed) && typeof parsed.error === "string") {
      throw new Error(parsed.error);
    }
    throw new Error(`upstream error (${res.status})`);
  }

  return parsed;
}

function summarizeLecture(lecture: Record<string, unknown>) {
  return {
    course_title: String(lecture.course_title ?? ""),
    instructor: String(lecture.instructor ?? ""),
    course_number: String(lecture.course_number ?? ""),
    lecture_number: String(lecture.lecture_number ?? ""),
    department: String(lecture.department ?? ""),
    class_time_json: Array.isArray(lecture.class_time_json)
      ? lecture.class_time_json.slice(0, 6)
      : [],
  };
}

function summarizeFreeRooms(rooms: Array<{ room: string; until: number }>) {
  return rooms
    .slice(0, 12)
    .map((room) => `${room.room} (~${toHHmm(room.until)})`)
    .join(", ");
}

function toHHmm(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

async function runToolCall(req: NextRequest, toolName: string, args: unknown) {
  if (toolName === TOOL_SEARCH_TIMETABLE) {
    const parsed = timetableInputSchema.safeParse(args);
    if (!parsed.success) {
      throw new RpcRequestError(
        RPC_ERRORS.INVALID_PARAMS,
        "invalid arguments for search_timetable"
      );
    }

    const input = parsed.data;
    const semester = normalizeSemesterOrThrow(input.semester);
    const raw = await callSnuttApi(req, "/api/snutt/search", {
      year: input.year,
      semester,
    });

    if (!Array.isArray(raw)) throw new Error("unexpected search response");

    const lectures = raw.filter((x): x is Record<string, unknown> => isRecord(x));
    const filtered =
      input.search_type === "professor"
        ? lectures.filter((lec) => lectureMatchesProfessorExact(lec, input.query))
        : lectures.filter((lec) => lectureMatchesRoomExact(lec, input.query));
    const events = buildEventsFromLectures(filtered, {
      showBy: input.search_type,
      query: input.query,
    });

    return {
      structuredContent: {
        year: input.year,
        semester,
        search_type: input.search_type,
        query: input.query,
        lecture_count: filtered.length,
        event_count: events.length,
        events,
        lectures_preview: filtered.slice(0, 30).map(summarizeLecture),
        is_truncated: filtered.length > 30,
      },
      content: [
        {
          type: "text",
          text: `${input.search_type === "professor" ? "교수명" : "강의실"} \"${input.query}\" 기준으로 ${events.length}개의 시간표 이벤트를 찾았습니다.`,
        },
      ],
      _meta: {
        mode: input.search_type,
        year: String(input.year),
        semester,
        q: input.query,
      },
    };
  }

  if (toolName === TOOL_FIND_FREE_ROOMS) {
    const parsed = freeRoomsInputSchema.safeParse(args);
    if (!parsed.success) {
      throw new RpcRequestError(RPC_ERRORS.INVALID_PARAMS, "invalid arguments for find_free_rooms");
    }

    const input = parsed.data;
    const semester = normalizeSemesterOrThrow(input.semester);
    const raw = await callSnuttApi(req, "/api/snutt/free-rooms", {
      year: input.year,
      semester,
      building: input.building,
      day: input.day,
      at: input.at,
    });

    if (!Array.isArray(raw)) throw new Error("unexpected free rooms response");

    const freeRooms = raw.filter(
      (v): v is { room: string; until: number } =>
        isRecord(v) && typeof v.room === "string" && typeof v.until === "number"
    );
    const summary = summarizeFreeRooms(freeRooms);

    return {
      structuredContent: {
        year: input.year,
        semester,
        building: input.building,
        day: input.day,
        at: input.at,
        free_room_count: freeRooms.length,
        free_rooms: freeRooms,
      },
      content: [
        {
          type: "text",
          text:
            freeRooms.length > 0
              ? `${input.building}동에서 현재 비어 있는 강의실 ${freeRooms.length}개를 찾았습니다. ${summary}`
              : `${input.building}동에서 현재 비어 있는 강의실을 찾지 못했습니다.`,
        },
      ],
      _meta: {
        mode: "free",
        year: String(input.year),
        semester,
        q: input.building,
      },
    };
  }

  if (toolName === TOOL_FIND_NEARBY_BUILDINGS) {
    const parsed = nearbyBuildingsInputSchema.safeParse(args);
    if (!parsed.success) {
      throw new RpcRequestError(
        RPC_ERRORS.INVALID_PARAMS,
        "invalid arguments for find_nearby_free_room_buildings"
      );
    }

    const input = parsed.data;
    const semester = normalizeSemesterOrThrow(input.semester);
    const format = input.format ?? "buildings";
    const raw = await callSnuttApi(req, "/api/snutt/recommendation/location", {
      year: input.year,
      semester,
      lat: input.lat,
      lon: input.lon,
      day: input.day,
      at: input.at,
      limit: input.limit ?? 20,
      radiusMeters: input.radiusMeters,
      format,
    });

    if (!Array.isArray(raw)) throw new Error("unexpected nearby recommendation response");

    return {
      structuredContent: {
        year: input.year,
        semester,
        lat: input.lat,
        lon: input.lon,
        day: input.day,
        at: input.at,
        limit: input.limit ?? 20,
        radiusMeters: input.radiusMeters,
        format,
        count: raw.length,
        items: raw,
      },
      content: [
        {
          type: "text",
          text:
            format === "buildings"
              ? `주변 빈 강의실 건물 ${raw.length}개를 거리순으로 불러왔습니다.`
              : `주변 빈 강의실 ${raw.length}개를 거리순으로 불러왔습니다.`,
        },
      ],
      _meta: {
        mode: "free",
        year: String(input.year),
        semester,
      },
    };
  }

  throw new RpcRequestError(RPC_ERRORS.INVALID_PARAMS, `unknown tool: ${toolName}`);
}

function mapMethod(method: string) {
  switch (method) {
    case "list_tools":
      return "tools/list";
    case "call_tool":
      return "tools/call";
    case "list_resources":
      return "resources/list";
    case "read_resource":
      return "resources/read";
    default:
      return method;
  }
}

async function handleRequestObject(
  req: NextRequest,
  payload: unknown
): Promise<JsonRpcResponse | null> {
  if (!isRecord(payload)) {
    return rpcError(null, RPC_ERRORS.INVALID_REQUEST, "Invalid Request");
  }

  const rpcReq: JsonRpcRequest = payload;
  const id = hasId(rpcReq) ? rpcReq.id : null;
  const isNotification = !hasId(rpcReq);

  if (rpcReq.jsonrpc !== "2.0" || typeof rpcReq.method !== "string") {
    if (isNotification) return null;
    return rpcError(id, RPC_ERRORS.INVALID_REQUEST, "Invalid Request");
  }

  const method = mapMethod(rpcReq.method);

  try {
    if (method === "initialize") {
      if (isNotification) return null;
      return rpcSuccess(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: SERVER_INFO,
        instructions:
          "SNUTT/TTuns API를 MCP tool로 제공합니다. 시간표 검색 및 빈 강의실 조회 도구를 사용할 수 있습니다.",
      });
    }

    if (method === "notifications/initialized") {
      return isNotification ? null : rpcSuccess(id, {});
    }

    if (method === "ping") {
      if (isNotification) return null;
      return rpcSuccess(id, {});
    }

    if (method === "tools/list") {
      if (isNotification) return null;
      return rpcSuccess(id, { tools: toolDescriptors() });
    }

    if (method === "tools/call") {
      if (isNotification) return null;
      const parsed = toolCallInputSchema.safeParse(rpcReq.params);
      if (!parsed.success) {
        return rpcError(id, RPC_ERRORS.INVALID_PARAMS, "Invalid tools/call params");
      }

      const { name, arguments: args } = parsed.data;
      const result = await runToolCall(req, name, args ?? {});
      return rpcSuccess(id, result);
    }

    if (method === "resources/list") {
      if (isNotification) return null;
      return rpcSuccess(id, {
        resources: [
          {
            uri: URI_TIMETABLE_WIDGET,
            name: "TTuns 시간표 위젯",
            description: "ChatGPT tool 결과를 시간표 형태로 표시하는 읽기 전용 UI",
            mimeType: RESOURCE_MIME_TYPE,
          },
          {
            uri: URI_FREE_ROOMS_WIDGET,
            name: "TTuns 빈 강의실 위젯",
            description: "ChatGPT tool 결과를 빈 강의실/주변 추천 형태로 표시하는 읽기 전용 UI",
            mimeType: RESOURCE_MIME_TYPE,
          },
        ],
      });
    }

    if (method === "resources/read") {
      if (isNotification) return null;
      const parsed = resourcesReadInputSchema.safeParse(rpcReq.params);
      if (!parsed.success) {
        return rpcError(id, RPC_ERRORS.INVALID_PARAMS, "Invalid resources/read params");
      }

      const origin = getOrigin(req);
      const { uri } = parsed.data;

      if (uri === URI_TIMETABLE_WIDGET) {
        return rpcSuccess(id, {
          contents: [
            {
              uri,
              mimeType: RESOURCE_MIME_TYPE,
              text: buildWidgetIframeDocument(widgetSrc(origin, "timetable"), "TTuns 시간표"),
              _meta: widgetMeta(
                origin,
                "교수명/강의실 검색과 시간표 확인을 수행하는 TTuns 위젯입니다."
              ),
            },
          ],
        });
      }

      if (uri === URI_FREE_ROOMS_WIDGET) {
        return rpcSuccess(id, {
          contents: [
            {
              uri,
              mimeType: RESOURCE_MIME_TYPE,
              text: buildWidgetIframeDocument(widgetSrc(origin, "free-rooms"), "TTuns 빈 강의실"),
              _meta: widgetMeta(
                origin,
                "동번호 기반 빈 강의실 검색과 주변 건물 추천을 수행하는 TTuns 위젯입니다."
              ),
            },
          ],
        });
      }

      return rpcError(id, RPC_ERRORS.INVALID_PARAMS, "Unknown resource URI");
    }

    if (isNotification) return null;
    return rpcError(id, RPC_ERRORS.METHOD_NOT_FOUND, "Method not found");
  } catch (err) {
    if (isNotification) return null;
    if (err instanceof RpcRequestError) {
      return rpcError(id, err.code, err.message, err.data);
    }
    const message = err instanceof Error ? err.message : "Internal error";
    return rpcError(id, RPC_ERRORS.INTERNAL_ERROR, message);
  }
}

export async function OPTIONS() {
  return emptyWithCors(204);
}

export async function GET(req: NextRequest) {
  const origin = getOrigin(req);
  if (wantsEventStream(req)) {
    return sseEndpointWithCors(`${origin}/mcp`);
  }
  return responseWithCors({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocolVersion: MCP_PROTOCOL_VERSION,
    endpoint: `${origin}/mcp`,
    tools: [TOOL_SEARCH_TIMETABLE, TOOL_FIND_FREE_ROOMS, TOOL_FIND_NEARBY_BUILDINGS],
  });
}

export async function POST(req: NextRequest) {
  const asEventStream = wantsEventStream(req);
  // Work around MCP Inspector's streamable-http wrapper, which currently
  // throws when it reconstructs a 204 response as a web Response with a body.
  const emptyStatus = asEventStream ? 202 : 204;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const error = rpcError(null, RPC_ERRORS.PARSE_ERROR, "Parse error");
    return asEventStream ? sseWithCors(error, 400) : responseWithCors(error, 400);
  }

  if (Array.isArray(body)) {
    if (body.length === 0) {
      const error = rpcError(null, RPC_ERRORS.INVALID_REQUEST, "Invalid Request");
      return asEventStream ? sseWithCors(error, 400) : responseWithCors(error, 400);
    }
    const results = await Promise.all(body.map((item) => handleRequestObject(req, item)));
    const responses = results.filter((r): r is JsonRpcResponse => r !== null);
    if (responses.length === 0) return emptyWithCors(emptyStatus);
    return asEventStream ? sseWithCors(responses) : responseWithCors(responses);
  }

  const response = await handleRequestObject(req, body);
  if (response === null) return emptyWithCors(emptyStatus);
  return asEventStream ? sseWithCors(response) : responseWithCors(response);
}
