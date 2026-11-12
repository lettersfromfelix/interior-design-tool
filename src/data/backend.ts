/** The file backend of this build: the dev server's file API locally (`npm start`), the browser on the website. */
import { diskBackend } from "./api";
import type { FileBackend } from "./fileBackend";
import { browserStorage, siteBackend } from "./siteBackend";

/**
 * The layout the website opens on a first visit (one of the layouts that come with it); later it opens the layout
 * that was open last. The local tool opens layouts/default.json.
 */
const WEBSITE_START_LAYOUT = "layouts/living1.json";

function website(): FileBackend {
  const { storage, durable } = browserStorage();
  return siteBackend(import.meta.env.BASE_URL, storage, { events: window, durable, startLayout: WEBSITE_START_LAYOUT });
}

export const backend: FileBackend = import.meta.env.DEV ? diskBackend : website();

/** True on the published website (layouts live in the browser), false in the local tool (layouts are files). */
export const isWebsite = backend.kind === "browser";
