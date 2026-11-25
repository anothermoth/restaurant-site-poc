// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { parseMenu } from "@restaurant-site-poc/menu-schema";
import Cart from "../src/components/Cart.tsx";
import { baseMenu } from "../../../packages/menu-schema/test/fixtures.ts";

const menu = parseMenu(baseMenu());

function addButton(itemId: string) {
  const b = document.createElement("button");
  b.dataset.addItem = itemId;
  b.textContent = `Add ${itemId}`;
  document.body.appendChild(b);
  return b;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("<Cart /> island", () => {
  it("adds a simple item from a static button via event delegation", () => {
    render(<Cart menu={menu} storageKey="t1" />);
    act(() => addButton("salad").click());
    expect(screen.getByRole("button", { name: /open cart, 1 items/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /open cart/i }));
    expect(screen.getByRole("dialog", { name: "Your order" }).textContent).toContain("Garden Salad");
    expect(JSON.parse(localStorage.getItem("t1")!)).toHaveLength(1);
  });

  it("opens the modifier picker for items with modifier groups and prices the choice", () => {
    render(<Cart menu={menu} storageKey="t2" />);
    act(() => addButton("burger").click());
    const dialog = screen.getByRole("dialog", { name: "Customize Burger" });
    fireEvent.click(screen.getByLabelText(/^Large/));
    fireEvent.click(screen.getByLabelText(/^Bacon/));
    expect(dialog.textContent).toContain("$17.00");
    fireEvent.click(screen.getByRole("button", { name: /add to cart/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /open cart, 1 items/i }).textContent).toContain("$17.00");
  });

  it("restores a saved cart from localStorage", () => {
    localStorage.setItem("t3", JSON.stringify([{ key: "soup", itemId: "soup", quantity: 3 }]));
    render(<Cart menu={menu} storageKey="t3" />);
    expect(screen.getByRole("button", { name: /open cart, 3 items/i })).toBeTruthy();
  });
});
