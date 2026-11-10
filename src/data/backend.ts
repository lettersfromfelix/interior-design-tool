/** The file backend of this build: the dev server's file API locally (`npm start`), the browser on the website. */
import { diskBackend } from "./api";
import type { FileBackend } from "./fileBackend";
import { browserStorage, siteBackend } from "./siteBackend";

function website(): FileBackend {
  const { storage, durable } = browserStorage();
  return siteBackend(import.meta.env.BASE_URL, storage, { events: window, durable });
}

export const backend: FileBackend = import.meta.env.DEV ? diskBackend : website();

/** True on the published website (layouts live in the browser), false in the local tool (layouts are files). */
export const isWebsite = backend.kind === "browser";
