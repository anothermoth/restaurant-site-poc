import { Editor } from "../components/Editor.tsx";

export default function Page() {
  return <Editor slug={process.env.SITE_SLUG ?? "ember-and-elm"} siteUrl={process.env.PUBLIC_SITE_URL ?? "http://localhost:4321"} />;
}
