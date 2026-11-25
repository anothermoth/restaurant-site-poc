import { PublishedView } from "../../components/PublishedView.tsx";

export const metadata = { title: "Published preview", robots: { index: false } };

export default function Page() {
  return <PublishedView slug={process.env.SITE_SLUG ?? "ember-and-elm"} />;
}
