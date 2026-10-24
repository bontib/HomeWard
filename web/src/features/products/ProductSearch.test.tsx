// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductSearchResponse } from "@/lib/contracts";
import { StoreProvider } from "@/store/StoreProvider";
import { ProductSearch } from "./ProductSearch";

const READY: ProductSearchResponse = {
  query: "playstation",
  status: "READY",
  products: [
    {
      cpe: "cpe:2.3:o:sony:playstation_5_firmware",
      title: "Sony PlayStation 5",
      vendor: "Sony",
      latestVersion: "25.02",
    },
  ],
};
const PENDING: ProductSearchResponse = { query: "playstation", status: "PENDING", products: [] };

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function renderSearch(onSelect = vi.fn(), onChooseOther = vi.fn()) {
  render(
    <StoreProvider>
      <ProductSearch selectedCpe={null} onSelect={onSelect} onChooseOther={onChooseOther} />
    </StoreProvider>,
  );
  return { onSelect, onChooseOther };
}

describe("ProductSearch", () => {
  beforeEach(() => {
    // Node's Request only takes absolute URLs; the app uses "/api/...".
    const NodeRequest = Request;
    vi.stubGlobal(
      "Request",
      class extends NodeRequest {
        constructor(input: RequestInfo | URL, init?: RequestInit) {
          super(
            typeof input === "string" && input.startsWith("/") ? `http://localhost${input}` : input,
            init,
          );
        }
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits for 2 letters, then shows results as radio options", async () => {
    const fetchMock = vi.fn(async () => json(READY));
    vi.stubGlobal("fetch", fetchMock);
    const { onSelect } = renderSearch();

    await userEvent.type(screen.getByLabelText("Search for the brand or model"), "p");
    expect(screen.getByText("Type at least 2 letters.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Search for the brand or model"), "laystation");
    const option = await screen.findByRole("radio", { name: /Sony PlayStation 5/ });
    expect(screen.getByText("25.02")).toBeInTheDocument();
    await userEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith(READY.products[0]);
  });

  it("polls while pending and gives up with a plain message after 10 seconds", async () => {
    const fetchMock = vi.fn(async () => json(PENDING));
    vi.stubGlobal("fetch", fetchMock);
    renderSearch();

    const input = screen.getByLabelText("Search for the brand or model");
    await userEvent.type(input, "playstation");
    expect(await screen.findByText("Searching…")).toBeInTheDocument();

    // Real timers: wait just over 10 s.
    expect(
      await screen.findByText(/Search is taking longer than usual/, {}, { timeout: 12_000 }),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
  }, 20_000);

  it("offers Other with the typed text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(READY)),
    );
    const { onChooseOther } = renderSearch();
    await userEvent.type(screen.getByLabelText("Search for the brand or model"), "my gadget");
    await userEvent.click(screen.getByRole("button", { name: "Add it as Other" }));
    expect(onChooseOther).toHaveBeenCalledWith("my gadget");
  });
});
