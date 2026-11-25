import type { MenuInput } from "../src/index.ts";

export function baseMenu(): MenuInput {
  return {
    restaurant: {
      slug: "test-diner",
      name: "Test Diner",
      cuisine: ["American"],
      isSampleData: true,
      address: { street: "1 Test St", city: "Testville", region: "MO", postalCode: "00000", country: "US" },
    },
    modifierGroups: [
      { id: "size", name: "Size", minSelect: 1, maxSelect: 1, options: [{ id: "small", name: "Small" }, { id: "large", name: "Large", priceDelta: 300 }] },
      { id: "extras", name: "Extras", maxSelect: 2, options: [{ id: "cheese", name: "Cheese", priceDelta: 100 }, { id: "bacon", name: "Bacon", priceDelta: 200 }] },
    ],
    categories: [
      {
        id: "mains",
        name: "Mains",
        items: [
          { id: "burger", name: "Burger", description: "Beef patty with lettuce and tomato on a bun.", price: 1200, dietaryTags: ["contains-gluten"], modifierGroupIds: ["size", "extras"], photo: { src: "/a.svg", alt: "Burger", width: 4, height: 3 } },
          { id: "salad", name: "Garden Salad", description: "Mixed greens with lemon vinaigrette and seeds.", price: 1000, dietaryTags: ["vegan"], photo: { src: "/b.svg", alt: "Salad", width: 4, height: 3 } },
          { id: "soup", name: "Tomato Soup", description: "Slow-roasted tomato soup with basil and cream.", price: 800, dietaryTags: ["vegetarian"], photo: { src: "/c.svg", alt: "Soup", width: 4, height: 3 } },
        ],
      },
    ],
  };
}
