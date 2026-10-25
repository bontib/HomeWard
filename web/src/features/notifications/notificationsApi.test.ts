import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeStore } from "@/store";
import { notificationsApi } from "./api";
import { alertsOff, waitingForYou } from "./fixtures";

const OriginalRequest = globalThis.Request;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("notifications endpoints", () => {
  let settingsCalls = 0;
  let bodies: unknown[] = [];

  beforeEach(() => {
    settingsCalls = 0;
    bodies = [];
    globalThis.Request = class extends OriginalRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
      }
    } as typeof Request;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (req: Request) => {
        const { pathname } = new URL(req.url);
        if (req.method === "GET" && pathname === "/api/notifications") {
          settingsCalls += 1;
          return json({ settings: settingsCalls === 1 ? alertsOff : waitingForYou });
        }
        if (req.method === "PUT" && pathname === "/api/notifications/email") {
          bodies.push(await req.json());
          return json({ settings: waitingForYou, jobId: "job_1" });
        }
        return new Response("not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    globalThis.Request = OriginalRequest;
    vi.unstubAllGlobals();
  });

  it("unwraps the settings and refetches them after the switch changes", async () => {
    const store = makeStore();
    const first = await store.dispatch(
      notificationsApi.endpoints.getNotificationSettings.initiate(),
    );
    expect(first.data?.state).toBe("OFF");

    await store.dispatch(notificationsApi.endpoints.setEmailAlerts.initiate({ enabled: true }));
    expect(bodies).toEqual([{ enabled: true }]);
    await vi.waitFor(() => {
      const selected = notificationsApi.endpoints.getNotificationSettings.select()(
        store.getState(),
      );
      expect(selected.data?.state).toBe("PENDING_CONFIRM");
      expect(settingsCalls).toBe(2);
    });
  });
});
