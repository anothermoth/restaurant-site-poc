// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import sample from "../../../data/sample-restaurant.menu.json";
import { parseMenu } from "@restaurant-site-poc/menu-schema";
import { Preview } from "../components/Preview.tsx";
import { ChangeCard } from "../components/ChangeCard.tsx";
import { History } from "../components/History.tsx";
import { MicButton } from "../components/MicButton.tsx";
import type { Change } from "../lib/types.ts";

const menu = parseMenu(sample);

const change: Change = {
  id: "c1",
  utterance: "change the price of the margarita to $16.50",
  input: "voice",
  source: "parser",
  commands: [{ cmd: "set_price", itemId: "margherita", price: 1650 }],
  ops: [{ path: "/items/margherita/price", before: 1500, after: 1650 }],
  summary: ["Margherita: price $15.00 → $16.50"],
  risk: "high",
  findings: { added: [], resolved: [{ ruleId: "price-outlier", severity: "error", message: "Truffle Pie is 10x the median" }] },
  status: "pending",
  usage: null,
  published: false,
  createdAt: new Date().toISOString(),
  highlight: ["item:margherita", "item:margherita.price"],
};

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
});

describe("<Preview />", () => {
  it("renders stable data-edit-id targets and highlights the ones a change touches", () => {
    const { container } = render(<Preview menu={menu} highlight={change.highlight} />);
    const price = container.querySelector('[data-edit-id="item:margherita.price"]')!;
    expect(price.textContent).toBe("$15.00");
    expect(price.classList.contains("hl")).toBe(true);
    expect(container.querySelector('[data-edit-id="item:wings.price"]')!.classList.contains("hl")).toBe(false);
    expect(container.querySelector('[data-edit-id="restaurant.hours"]')!.textContent).toContain("Tue, Wed, Thu 11:00–21:00");
  });
});

describe("<ChangeCard />", () => {
  it("shows the before/after diff, risk badge, checker effect and cost line", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<ChangeCard change={change} onApprove={onApprove} onReject={onReject} />);
    expect(screen.getByText("$15.00").className).toBe("before");
    expect(screen.getByText("$16.50").className).toBe("after");
    expect(screen.getByText(/Needs approval/)).toBeTruthy();
    expect(screen.getByText(/Fixes: Truffle Pie/)).toBeTruthy();
    expect(screen.getByText(/no AI · \$0/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
  });

  it("shows token counts and cost for AI-proposed changes", () => {
    render(
      <ChangeCard
        change={{ ...change, source: "llm", usage: { model: "m", inputTokens: 640, cachedInputTokens: 512, outputTokens: 28, costUsd: 0.00033, latencyMs: 900 } }}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    );
    expect(screen.getByText(/640 in \(512 cached\) \/ 28 out · \$0\.00033/)).toBeTruthy();
  });
});

describe("<History />", () => {
  it("offers undo only on approved changes", () => {
    const onUndo = vi.fn();
    render(<History items={[{ ...change, status: "approved" }, { ...change, id: "c2", status: "rejected" }]} onUndo={onUndo} />);
    const buttons = screen.getAllByRole("button", { name: /Undo/ });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(onUndo).toHaveBeenCalledWith("c1");
  });
});

describe("<MicButton />", () => {
  it("falls back to a typing hint when speech recognition is unavailable", async () => {
    render(<MicButton onTranscript={() => {}} />);
    expect(await screen.findByText(/Type your change below instead/)).toBeTruthy();
  });

  it("push-to-talk: sends the final transcript on release", async () => {
    class FakeRecognition {
      lang = "";
      interimResults = false;
      continuous = false;
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror = null;
      start() {}
      stop() {
        this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "86 the burrata" } }] });
        this.onend?.();
      }
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    const onTranscript = vi.fn();
    render(<MicButton onTranscript={onTranscript} />);
    const btn = await screen.findByRole("button", { name: "Hold to talk" });
    act(() => {
      fireEvent.pointerDown(btn);
    });
    expect(screen.getByRole("button", { name: /Listening/ })).toBeTruthy();
    act(() => {
      fireEvent.pointerUp(btn);
    });
    expect(onTranscript).toHaveBeenCalledWith("86 the burrata");
  });
});
