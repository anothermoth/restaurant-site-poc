// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import sample from "../../../data/sample-restaurant.menu.json";
import { parseMenu } from "@restaurant-site-poc/menu-schema";
import { Preview } from "../components/Preview.tsx";
import { ChangeCard } from "../components/ChangeCard.tsx";
import { History } from "../components/History.tsx";
import { MicButton } from "../components/MicButton.tsx";
import { Editor } from "../components/Editor.tsx";
import type { Change, SiteState } from "../lib/types.ts";

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
  credits: 0,
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
    expect(screen.getByText(/Matched instantly · free/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
  });

  it("shows the cost of AI-proposed changes in credits, never dollars", () => {
    const { container } = render(<ChangeCard change={{ ...change, source: "llm", credits: 1 }} onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText("AI helper · 1 credit")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\$0\.|tokens/);
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

describe("<Preview published />", () => {
  it("drops hidden sections and 86'd items, like the Astro menu page", () => {
    const m = structuredClone(menu);
    m.categories[0]!.items[0]!.available = false;
    m.categories[4]!.hidden = true;
    const { container } = render(<Preview menu={m} published />);
    expect(container.querySelector(`[data-edit-id="item:${m.categories[0]!.items[0]!.id}"]`)).toBeNull();
    expect(container.querySelector(`[data-edit-id="category:${m.categories[4]!.id}"]`)).toBeNull();
    expect(container.querySelector(".pv-flag")).toBeNull();
  });
});

describe("<Editor /> credits", () => {
  const state = (balance: number, demo: boolean): SiteState => ({
    slug: "ember-and-elm",
    draftVersion: 1,
    publishedVersion: 1,
    publishedAt: null,
    unpublished: false,
    settings: { autoApproveLowRisk: false },
    draft: menu,
    preview: menu,
    pending: null,
    history: [],
    credits: { balance, perAiCall: 1 },
    activity: { parser: 3, ai: 2, aiCache: 1 },
    demo,
    sandboxIdleMinutes: demo ? 60 : null,
  });
  const serve = (s: SiteState) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => s })));

  it("shows 'N credits left' in the top bar instead of a dollar cost", async () => {
    serve(state(98, false));
    render(<Editor slug="ember-and-elm" siteUrl="http://localhost:4321" />);
    expect((await screen.findByTestId("credits")).textContent).toBe("98 credits left");
    expect(screen.getByRole("region", { name: "Edit mode" }).textContent).not.toMatch(/\$/);
    expect(screen.getByRole("link", { name: /Published site/ }).getAttribute("href")).toBe("http://localhost:4321");
    vi.unstubAllGlobals();
  });

  it("says the AI helper is paused at 0 credits, and in demo mode links the private preview", async () => {
    serve(state(0, true));
    render(<Editor slug="ember-and-elm" siteUrl="http://localhost:4321" />);
    expect((await screen.findByTestId("credits")).textContent).toBe("0 credits left · AI helper paused");
    expect(screen.getByRole("note").textContent).toMatch(/resets after 60 minutes/);
    expect(screen.getByRole("link", { name: /Your published preview/ }).getAttribute("href")).toBe("/published");
    vi.unstubAllGlobals();
  });
});

describe("click-to-target", () => {
  const base: SiteState = {
    slug: "ember-and-elm",
    draftVersion: 1,
    publishedVersion: 1,
    publishedAt: null,
    unpublished: false,
    settings: { autoApproveLowRisk: false },
    draft: menu,
    preview: menu,
    pending: null,
    history: [],
    credits: { balance: 25, perAiCall: 1 },
    activity: { parser: 0, ai: 0, aiCache: 0 },
    demo: false,
    sandboxIdleMinutes: null,
  };
  function serve() {
    const calls: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const json = url.endsWith("/commands") ? { type: "change", autoApproved: false, change: { ...change, utterance: "make this $14" } } : base;
        return { ok: true, status: 200, json: async () => json };
      }),
    );
    return calls;
  }
  afterEach(() => vi.unstubAllGlobals());

  it("clicking an item in the menu panel makes it the target and sends it with the command", async () => {
    const calls = serve();
    render(<Editor slug="ember-and-elm" />);
    const panel = await screen.findByRole("complementary", { name: "Menu items" });
    const item = within(panel).getByRole("button", { name: /Margherita/ });
    fireEvent.click(item);
    expect(item.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Clear selection Margherita" })).toBeTruthy();
    expect(document.querySelector('.pv [data-edit-id="item:margherita"]')!.classList.contains("sel")).toBe(true);

    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "make this $14" } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("Command").closest("form")!);
    });
    const post = calls.find((c) => c.url.endsWith("/commands"))!;
    expect(post.body).toEqual({ utterance: "make this $14", input: "text", target: { kind: "item", id: "margherita" } });
  });

  it("clears the target, and sends no target when nothing is selected", async () => {
    const calls = serve();
    render(<Editor slug="ember-and-elm" />);
    const panel = await screen.findByRole("complementary", { name: "Menu items" });
    fireEvent.click(within(panel).getByRole("button", { name: /Burrata/ }));
    fireEvent.click(screen.getByRole("button", { name: /Clear selection/ }));
    expect(screen.queryByRole("button", { name: /Clear selection/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "86 the burrata" } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("Command").closest("form")!);
    });
    expect(calls.find((c) => c.url.endsWith("/commands"))!.body).toEqual({ utterance: "86 the burrata", input: "text" });
  });

  it("clicking an item or section in the preview selects it too", async () => {
    serve();
    const { container } = render(<Editor slug="ember-and-elm" />);
    await screen.findByTestId("credits");
    fireEvent.click(container.querySelector('.pv [data-edit-id="item:tiramisu"]')!);
    expect(screen.getByRole("button", { name: "Clear selection Tiramisu" })).toBeTruthy();
    fireEvent.click(container.querySelector('.pv [data-edit-id="category:salads"] h2')!);
    expect(screen.getByRole("button", { name: "Clear selection Salads" })).toBeTruthy();
  });

  it("filters the menu panel by search", async () => {
    serve();
    render(<Editor slug="ember-and-elm" />);
    const panel = await screen.findByRole("complementary", { name: "Menu items" });
    fireEvent.change(within(panel).getByLabelText("Search the menu"), { target: { value: "burger" } });
    const names = within(panel).getAllByRole("button", { pressed: false }).map((b) => b.textContent);
    expect(names.some((n) => n?.includes("Double Smash Burger"))).toBe(true);
    expect(names.some((n) => n?.includes("Margherita"))).toBe(false);
  });
});
