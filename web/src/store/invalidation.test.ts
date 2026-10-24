import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { devicesApi } from "@/features/devices/devicesApi";
import { makeDevice } from "@/features/devices/fixtures";
import { makeStore } from "./index";

// Node cannot build a Request from the relative "/api" base, so give fetch an absolute origin.
const OriginalRequest = globalThis.Request;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("RTK Query tag invalidation (P2-4)", () => {
  let listCalls = 0;
  let listedNames: string[] = [];

  beforeEach(() => {
    listCalls = 0;
    listedNames = ["Front door camera"];
    globalThis.Request = class extends OriginalRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
      }
    } as typeof Request;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (req: Request) => {
        const { pathname } = new URL(req.url);
        if (req.method === "GET" && pathname === "/api/devices") {
          listCalls += 1;
          return json({ devices: listedNames.map((name) => makeDevice({ name })) });
        }
        if (req.method === "POST" && pathname === "/api/devices") {
          listedNames = [...listedNames, "New TV"];
          return json({ device: makeDevice({ id: "dev_2", name: "New TV" }), jobId: null });
        }
        return new Response("not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    globalThis.Request = OriginalRequest;
    vi.unstubAllGlobals();
  });

  it("refetches the device list after a device is created", async () => {
    const store = makeStore();
    const subscription = store.dispatch(devicesApi.endpoints.listDevices.initiate());
    const first = await subscription;
    expect(first.data?.devices).toHaveLength(1);

    await store.dispatch(
      devicesApi.endpoints.createDevice.initiate({ name: "New TV", type: "TV" } as never),
    );
    await vi.waitFor(() => expect(listCalls).toBe(2));

    await vi.waitFor(() =>
      expect(
        devicesApi.endpoints.listDevices.select()(store.getState()).data?.devices,
      ).toHaveLength(2),
    );
    subscription.unsubscribe();
  });
});
