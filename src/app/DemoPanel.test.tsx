// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { DemoPanel } = await import("./DemoPanel");

const realFetch = globalThis.fetch;
beforeEach(() => refresh.mockReset());
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("DemoPanel", () => {
  it("describes every scenario visibly, not only in a tooltip", () => {
    render(<DemoPanel />);
    const button = screen.getByRole("button", { name: "Retry the same delivery" });
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText(/dedup window drops it/)).toBeTruthy();
  });

  it("reports the outcomes and refreshes the event log", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ results: [{ kind: "deduped" }] })) as typeof fetch;
    render(<DemoPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Retry the same delivery" }));
    expect((await screen.findByRole("status")).textContent).toBe("Retry the same delivery: deduped");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("disables the buttons while a request is in flight", async () => {
    let finish!: (r: Response) => void;
    globalThis.fetch = vi.fn(() => new Promise<Response>((r) => (finish = r))) as typeof fetch;
    render(<DemoPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Autosave" }));
    expect(screen.getAllByRole("button").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    finish(Response.json({ results: [] }));
    await screen.findByText("Autosave: no outcome");
  });

  it("announces a server error with the API's message as an alert", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ error: "not_found", message: "The demo is disabled on the live pipeline." }, { status: 404 }),
    ) as typeof fetch;
    render(<DemoPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Publish an edit" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The demo is disabled on the live pipeline.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("explains a network failure instead of failing silently", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    render(<DemoPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Publish an edit" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/didn't reach the server/);
  });
});
