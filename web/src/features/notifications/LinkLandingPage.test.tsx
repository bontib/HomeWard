// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeStore } from "@/store";
import { LinkLandingPage } from "./LinkLandingPage";
import { makeLink } from "./fixtures";

const OriginalRequest = globalThis.Request;
const TOKEN = "v1.abcdefghijklmnop.signature123";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Calls = { method: string; path: string }[];

function mockApi(handler: (req: Request) => Response | Promise<Response>): Calls {
  const calls: Calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      calls.push({ method: req.method, path: new URL(req.url).pathname });
      return handler(req);
    }),
  );
  return calls;
}

function show(purpose: "confirm" | "unsubscribe", token: string | null = TOKEN) {
  render(
    <Provider store={makeStore()}>
      <LinkLandingPage purpose={purpose} token={token} />
    </Provider>,
  );
}

const invalid = (message: string) => json({ error: { code: "INVALID_LINK", message } }, 400);

beforeEach(() => {
  globalThis.Request = class extends OriginalRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  } as typeof Request;
});

afterEach(() => {
  globalThis.Request = OriginalRequest;
  vi.unstubAllGlobals();
});

describe("LinkLandingPage confirm", () => {
  it("only reads on load: nothing is turned on until the button is pressed", async () => {
    const calls = mockApi(() => json({ link: makeLink() }));
    show("confirm");
    expect(
      await screen.findByRole("heading", { name: "Turn on email alerts for y***@example.com?" }),
    ).toHaveFocus();
    expect(calls).toEqual([{ method: "GET", path: "/api/notifications/link" }]);
    expect(screen.getByRole("link", { name: "No, not now" })).toBeInTheDocument();
  });

  it("turns on after the button press and says what that means", async () => {
    const calls = mockApi((req) =>
      req.method === "POST" ? json({ state: "ON" }) : json({ link: makeLink() }),
    );
    show("confirm");
    await userEvent.click(await screen.findByRole("button", { name: "Turn on email alerts" }));
    expect(
      await screen.findByRole("heading", { name: "Email alerts are on." }),
    ).toBeInTheDocument();
    expect(calls.at(-1)).toEqual({ method: "POST", path: "/api/notifications/confirm" });
    expect(screen.getByText(/No email does not mean a device is safe/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Settings" })).toHaveAttribute(
      "href",
      "/settings/notifications",
    );
  });

  it("shows the same success page when the link was already used", async () => {
    mockApi(() => json({ link: makeLink({ alreadyDone: true }) }));
    show("confirm");
    expect(
      await screen.findByRole("heading", { name: "Email alerts are on." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on email alerts" })).toBeNull();
  });

  it("shows the API sentence for an expired link, without an address", async () => {
    mockApi(() =>
      invalid("This link has expired. Turn on alerts again in Settings > Notifications."),
    );
    show("confirm");
    expect(
      await screen.findByRole("heading", { name: "This link doesn't work." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/This link has expired/)).toBeInTheDocument();
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it("treats a missing token as a broken link without asking the server", () => {
    const calls = mockApi(() => json({}));
    show("confirm", null);
    expect(screen.getByRole("heading", { name: "This link doesn't work." })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("lets the person try again after a server error", async () => {
    let posts = 0;
    mockApi((req) => {
      if (req.method !== "POST") return json({ link: makeLink() });
      posts += 1;
      return posts === 1
        ? json({ error: { code: "INTERNAL", message: "Something went wrong. Try again." } }, 500)
        : json({ state: "ON" });
    });
    show("confirm");
    await userEvent.click(await screen.findByRole("button", { name: "Turn on email alerts" }));
    expect(
      await screen.findByRole("heading", {
        name: "We couldn't turn on email alerts. Try again in a minute.",
      }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await userEvent.click(await screen.findByRole("button", { name: "Turn on email alerts" }));
    expect(
      await screen.findByRole("heading", { name: "Email alerts are on." }),
    ).toBeInTheDocument();
  });

  it("says when email is not set up on the server", async () => {
    mockApi((req) =>
      req.method === "POST"
        ? json(
            {
              error: {
                code: "CONFLICT",
                message: "Email alerts aren't set up on this HomeGuard yet.",
              },
            },
            409,
          )
        : json({ link: makeLink() }),
    );
    show("confirm");
    await userEvent.click(await screen.findByRole("button", { name: "Turn on email alerts" }));
    expect(
      await screen.findByRole("heading", {
        name: "Email alerts aren't set up on this HomeGuard yet.",
      }),
    ).toBeInTheDocument();
  });
});

describe("LinkLandingPage unsubscribe", () => {
  it("asks first and says devices are still checked", async () => {
    const calls = mockApi(() => json({ link: makeLink({ purpose: "unsubscribe" }) }));
    show("unsubscribe");
    expect(
      await screen.findByRole("heading", { name: "Stop email alerts for y***@example.com?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your devices are still checked every day/)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it("stops alerts on the button press", async () => {
    const calls = mockApi((req) =>
      req.method === "POST"
        ? json({ state: "OFF" })
        : json({ link: makeLink({ purpose: "unsubscribe" }) }),
    );
    show("unsubscribe");
    await userEvent.click(await screen.findByRole("button", { name: "Stop email alerts" }));
    expect(
      await screen.findByRole("heading", { name: "Email alerts are off." }),
    ).toBeInTheDocument();
    expect(screen.getByText("You can turn them on again in Settings.")).toBeInTheDocument();
    expect(calls.at(-1)).toEqual({ method: "POST", path: "/api/notifications/unsubscribe" });
  });

  it("shows the invalid page with the Settings hint from the API", async () => {
    mockApi(() =>
      invalid("This link doesn't work. You can turn alerts off in Settings > Notifications."),
    );
    show("unsubscribe");
    expect(await screen.findByText(/turn alerts off in Settings/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Settings" })).toBeInTheDocument();
  });
});
