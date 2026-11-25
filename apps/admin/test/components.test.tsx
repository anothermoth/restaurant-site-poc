// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import sample from "../../../data/sample-restaurant.menu.json";
import { parseMenu } from "@restaurant-site-poc/menu-schema";
import { Preview } from "../components/Preview.tsx";
import { ChangeCard } from "../components/ChangeCard.tsx";
import { History } from "../components/History.tsx";
import { MicButton } from "../components/MicButton.tsx";
import { Editor, SUGGESTIONS } from "../components/Editor.tsx";
import { parse } from "@restaurant-site-poc/command-engine";
import { plainRows } from "../lib/format.ts";
import { itemNotes } from "../components/MenuPanel.tsx";
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
    expect(price.textContent).toBe("$15");
    expect(price.classList.contains("hl")).toBe(true);
    expect(container.querySelector('[data-edit-id="item:wings.price"]')!.classList.contains("hl")).toBe(false);
    expect(container.querySelector('[data-edit-id="restaurant.hours"]')!.textContent).toContain("Tue, Wed, Thu 11:00–21:00");
  });
});

describe("<Preview /> menu design", () => {
  it("shows names as they will publish, plain-word dietary notes, and one photo per section", () => {
    const { container } = render(<Preview menu={menu} />);
    expect(container.querySelector('[data-edit-id="item:garlic-knots.name"]')!.textContent).toBe("Garlic Knots");
    expect(container.querySelector('[data-edit-id="item:garlic-knots.tags"]')!.textContent).toBe("VegetarianContains dairy & gluten");
    expect(container.textContent).not.toMatch(/contains-dairy|contains-gluten/);
    const sections = container.querySelectorAll(".pv-cat");
    for (const sec of sections) expect(sec.querySelectorAll("img").length).toBeLessThanOrEqual(1);
    // The draft itself is untouched.
    expect(menu.categories[0]!.items.find((i) => i.id === "garlic-knots")!.name).toBe("GARLIC KNOTS");
  });
});

describe("<ChangeCard />", () => {
  it("shows the before/after diff, risk badge, checker effect and cost line", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const { container } = render(<ChangeCard change={change} menu={menu} onApprove={onApprove} onReject={onReject} />);
    // Plain words up front: what changes, old value crossed out, new value.
    expect(container.querySelector(".review-row dt")!.textContent).toBe("Margherita · Price");
    expect(container.querySelector(".review-row .before")!.textContent).toBe("$15.00");
    expect(container.querySelector(".review-row .after")!.textContent).toBe("$16.50");
    expect(screen.getByText(/always wait for your OK/)).toBeTruthy();
    expect(screen.getByText(/fixes a problem on your menu/)).toBeTruthy();
    // The technical diff, checker messages and cost sit behind "Details".
    const details = container.querySelector("details")!;
    expect(within(details as HTMLElement).getByText(/Fixes: Truffle Pie/)).toBeTruthy();
    expect(details.textContent).toMatch(/Needs approval/);
    expect(details.textContent).toMatch(/Matched instantly · free/);
    expect(details.querySelector("code")!.textContent).toBe("margherita · price");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
  });

  it("shows the cost of AI-proposed changes in credits, never dollars", () => {
    const { container } = render(<ChangeCard change={{ ...change, source: "llm", credits: 1 }} onApprove={() => {}} onReject={() => {}} />);
    expect(container.querySelector("details")!.textContent).toMatch(/AI helper · 1 credit/);
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
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    expect((await screen.findByTestId("credits")).textContent).toBe("98 credits left");
    expect(screen.getByRole("region", { name: "Edit mode" }).textContent).not.toMatch(/\$/);
    expect(screen.getByRole("menuitem", { name: /Published site/ }).getAttribute("href")).toBe("http://localhost:4321");
    vi.unstubAllGlobals();
  });

  it("says the AI helper is paused at 0 credits, and in demo mode links the private preview", async () => {
    serve(state(0, true));
    render(<Editor slug="ember-and-elm" siteUrl="http://localhost:4321" />);
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    expect((await screen.findByTestId("credits")).textContent).toBe("0 credits left · AI helper paused");
    expect(screen.getByRole("note").textContent).toMatch(/resets after 60 minutes/);
    expect(screen.getByRole("menuitem", { name: /Your published preview/ }).getAttribute("href")).toBe("/published");
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
    // The menu is on demand, not always open.
    expect(screen.queryByRole("complementary", { name: "Menu items" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /pick something from your menu/i }));
    const panel = await screen.findByRole("complementary", { name: "Menu items" });
    fireEvent.click(within(panel).getByRole("button", { name: /Margherita/ }));
    // Picking closes the sheet; reopening shows the item selected.
    expect(screen.queryByRole("complementary", { name: "Menu items" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Browse your menu" }));
    expect(within(screen.getByRole("complementary", { name: "Menu items" })).getByRole("button", { name: /Margherita/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Clear selection Margherita" })).toBeTruthy();
    expect(document.querySelector('.pv [data-edit-id="item:margherita"]')!.classList.contains("sel")).toBe(true);

    fireEvent.change(screen.getByLabelText("What would you like to change?"), { target: { value: "make this $14" } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("What would you like to change?").closest("form")!);
    });
    const post = calls.find((c) => c.url.endsWith("/commands"))!;
    expect(post.body).toEqual({ utterance: "make this $14", input: "text", target: { kind: "item", id: "margherita" } });
  });

  it("clears the target, and sends no target when nothing is selected", async () => {
    const calls = serve();
    render(<Editor slug="ember-and-elm" />);
    fireEvent.click(await screen.findByRole("button", { name: /pick something from your menu/i }));
    const panel = await screen.findByRole("complementary", { name: "Menu items" });
    fireEvent.click(within(panel).getByRole("button", { name: /Burrata/ }));
    fireEvent.click(screen.getByRole("button", { name: /Clear selection/ }));
    expect(screen.queryByRole("button", { name: /Clear selection/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("What would you like to change?"), { target: { value: "86 the burrata" } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("What would you like to change?").closest("form")!);
    });
    expect(calls.find((c) => c.url.endsWith("/commands"))!.body).toEqual({ utterance: "86 the burrata", input: "text" });
  });

  it("clicking an item or section in the preview selects it too", async () => {
    serve();
    const { container } = render(<Editor slug="ember-and-elm" />);
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(container.querySelector('.pv [data-edit-id="item:tiramisu"]')!);
    expect(screen.getByRole("button", { name: "Clear selection Tiramisu" })).toBeTruthy();
    fireEvent.click(container.querySelector('.pv [data-edit-id="category:salads"] h2')!);
    expect(screen.getByRole("button", { name: "Clear selection Salads" })).toBeTruthy();
  });

  it("filters the menu panel by search", async () => {
    serve();
    render(<Editor slug="ember-and-elm" />);
    fireEvent.click(await screen.findByRole("button", { name: /pick something from your menu/i }));
    const panel = await screen.findByRole("complementary", { name: "Menu items" });
    fireEvent.change(within(panel).getByLabelText("Search the menu"), { target: { value: "burger" } });
    const names = within(panel).getAllByRole("button", { pressed: false }).map((b) => b.textContent);
    expect(names.some((n) => n?.includes("Double Smash Burger"))).toBe(true);
    expect(names.some((n) => n?.includes("Margherita"))).toBe(false);
  });
});

describe("menu panel checker notes", () => {
  it("marks raw draft names and other findings so they read as known issues", () => {
    const notes = itemNotes(menu);
    expect(notes.get("garlic-knots")).toMatchObject({ severity: "info", label: "Publishes as “Garlic Knots”" });
    expect(notes.get("truffle-pie")).toMatchObject({ severity: "error", label: "Price looks off" });
    expect(notes.get("caesar-2")!.label).toMatch(/^Possible duplicate \+\d/);
    expect(notes.has("margherita")).toBe(false);
  });
});

describe("<Editor /> publish button", () => {
  const s = (over: Partial<SiteState>): SiteState => ({
    slug: "ember-and-elm",
    draftVersion: 3,
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
    ...over,
  });
  afterEach(() => vi.unstubAllGlobals());
  const serve = (st: SiteState) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => st })));

  it("is disabled with a reason when there is nothing to publish or a change is pending", async () => {
    serve(s({}));
    render(<Editor slug="ember-and-elm" />);
    const btn = await screen.findByRole("button", { name: /^Publish/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("title")).toBe("Nothing new to publish");
    cleanup();
    serve(s({ unpublished: true, pending: change }));
    render(<Editor slug="ember-and-elm" />);
    expect((await screen.findByRole("button", { name: /^Publish/ })).getAttribute("title")).toBe("Approve or reject the pending change first");
  });

  it("is enabled and shows the count of approved, unpublished changes", async () => {
    serve(s({ unpublished: true, history: [{ ...change, id: "a", status: "approved" }, { ...change, id: "b", status: "approved" }] }));
    render(<Editor slug="ember-and-elm" />);
    const btn = await screen.findByRole("button", { name: /^Publish/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(btn.textContent).toBe("Publish2");
    expect(btn.getAttribute("title")).toBe("Publish 2 approved changes");
  });
});

describe("owner-first editor", () => {
  const base = (over: Partial<SiteState> = {}): SiteState => ({
    slug: "ember-and-elm",
    draftVersion: 4,
    publishedVersion: 2,
    publishedAt: null,
    unpublished: false,
    settings: { autoApproveLowRisk: false },
    draft: menu,
    preview: menu,
    pending: null,
    history: [],
    credits: { balance: 25, perAiCall: 1 },
    activity: { parser: 0, ai: 0, aiCache: 0 },
    demo: true,
    sandboxIdleMinutes: 60,
    ...over,
  });
  afterEach(() => vi.unstubAllGlobals());
  const serve = (st: SiteState) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => st })));

  it("starter suggestions are plain sentences the built-in parser handles (never an AI credit)", () => {
    expect(SUGGESTIONS.length).toBeLessThanOrEqual(3);
    for (const s of SUGGESTIONS) expect(parse(s, menu).kind, s).toBe("commands");
  });

  it("idle screen: one question, the ask box, three ideas; no jargon, versions or credits on show", async () => {
    serve(base());
    const { container } = render(<Editor slug="ember-and-elm" />);
    expect(await screen.findByRole("heading", { name: "What would you like to change?" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Make a change" }).querySelector(".ideas") as HTMLElement).getAllByRole("button")).toHaveLength(4); // 3 ideas + pick from menu
    const visible = (container.querySelector(".topbar")!.textContent ?? "") + (container.querySelector(".assistant")!.textContent ?? "");
    expect(visible).not.toMatch(/\bv\d|draft|command|schema|credit|checker|parser|LLM/i);
    expect(screen.queryByTestId("credits")).toBeNull(); // tucked behind ⋯
    expect(screen.queryByRole("complementary")).toBeNull(); // menu and history are on demand
  });

  it("shows the pending change instead of the ideas, and the preview says it's highlighted", async () => {
    serve(base({ pending: change, unpublished: false }));
    render(<Editor slug="ember-and-elm" />);
    expect(await screen.findByRole("region", { name: "Pending change" })).toBeTruthy();
    expect(screen.queryByLabelText("Suggestions")).toBeNull();
    expect(screen.getByText("Preview with your change highlighted")).toBeTruthy();
  });

  it("history and settings open from ⋯ in owner words, with undo", async () => {
    serve(base({ unpublished: true, history: [{ ...change, id: "a", status: "approved" }] }));
    render(<Editor slug="ember-and-elm" />);
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    expect(screen.getByText("1 change saved, not on your website yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Recent changes/ }));
    const sheet = screen.getByRole("complementary", { name: "Recent changes" });
    expect(within(sheet).getByText("Saved")).toBeTruthy();
    expect(within(sheet).getByText("Not published yet")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: /Undo/ })).toBeTruthy();
    expect(within(sheet).getByLabelText(/Read replies aloud/)).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Start the demo over" })).toBeTruthy();
  });

  it("plainRows names items and fields the way an owner would", () => {
    expect(plainRows(change, menu)).toEqual([{ key: "/items/margherita/price", what: "Margherita · Price", before: "$15.00", after: "$16.50" }]);
    const hide = { ops: [{ path: "/items/burrata/available", before: true, after: false }], summary: [] };
    expect(plainRows(hide, menu)[0]).toMatchObject({ what: "Burrata & Heirloom Tomatoes · On the menu", before: "Showing", after: "Hidden" });
    expect(plainRows({ ops: [{ path: "/categories/salads/itemOrder", before: [], after: [] }], summary: [] }, menu)).toEqual([]);
  });
});
