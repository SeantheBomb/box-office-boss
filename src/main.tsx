import { render } from "preact";
import { App } from "./surface/app";
import { assemble, fetchPublished, loadDraft } from "./data/content";
import "./surface/styles.css";

async function boot() {
  const published = await fetchPublished();
  const content = assemble(published, loadDraft());
  render(<App content={content} />, document.getElementById("app")!);
}

boot();
