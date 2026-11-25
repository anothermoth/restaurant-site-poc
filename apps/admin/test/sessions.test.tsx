// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SessionsView } from "../components/SessionsView.tsx";
import { formatChicago, isInternalPath } from "../lib/format.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("format helpers", () => {
  it("shows times in America/Chicago", () => {
    expect(formatChicago("2026-11-25T20:31:00.000Z")).toBe("Nov 25, 2:31 PM CST");
    expect(formatChicago("2026-07-04T17:00:00.000Z")).toBe("Jul 4, 12:00 PM CDT");
  });
  it("keeps internal pages out of analytics", () => {
    expect(isInternalPath("/admin/sessions")).toBe(true);
    expect(isInternalPath("/dev")).toBe(true);
    expect(isInternalPath("/")).toBe(false);
    expect(isInternalPath("/published")).toBe(false);
    expect(isInternalPath("/developer")).toBe(false);
  });
});

describe("SessionsView", () => {
  it("sends the token as a header (not in the URL) and renders sessions in Central time", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        days: 7,
        generatedAt: "2026-11-25T20:40:00.000Z",
        totals: { sessions: 1, active: 1, withRequests: 1, requests: 2, approved: 1, undone: 0, published: 1, aiCalls: 1, aiCostUsd: 0.0007 },
        sessions: [
          {
            id: "abcd1234",
            createdAt: "2026-11-25T20:31:00.000Z",
            lastSeenAt: "2026-11-25T20:35:00.000Z",
            active: true,
            requests: 2,
            approved: 1,
            rejected: 0,
            undone: 0,
            published: 1,
            clarify: 0,
            refused: 0,
            aiCalls: 1,
            aiCostUsd: 0.0007,
            utterances: [{ at: "2026-11-25T20:31:00.000Z", type: "proposed", text: "86 the burrata" }],
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionsView />);
    fireEvent.change(screen.getByPlaceholderText("Admin token"), { target: { value: "tok-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByText("abcd1234 ●")).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/sessions?days=7");
    expect(url).not.toContain("tok-123");
    expect((init!.headers as Record<string, string>)["x-admin-token"]).toBe("tok-123");
    expect(screen.getByText("Nov 25, 2:31 PM CST")).toBeTruthy();
    expect(screen.getByText(/86 the burrata/)).toBeTruthy();
  });

  it("shows the API error when the token is wrong", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: "Admin token required" }) })));
    render(<SessionsView />);
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByText("Admin token required")).toBeTruthy();
  });
});
