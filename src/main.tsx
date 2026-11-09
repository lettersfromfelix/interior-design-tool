import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LayoutSync } from "./data/layoutSync";
import { Repository } from "./data/repository";
import { ModelLibrary } from "./engine/items/models";
import { ThumbnailService } from "./engine/thumbnails";
import { createAppStore } from "./state/store";
import { App } from "./ui/App";
import { ServicesContext } from "./ui/services";
import { StoreContext } from "./ui/store";
import "./ui/styles.css";

const store = createAppStore();
const models = new ModelLibrary((file, issues) => store.getState().setRuntimeIssues(file, issues));
const repository = new Repository(store);
void repository.start();
new LayoutSync(store, { onConflict: () => void repository.reload("layouts") }).start();
new ThumbnailService(store, models).start();
if (import.meta.env.DEV) (window as unknown as { __store?: typeof store }).__store = store; // for debugging in the browser console

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreContext.Provider value={store}>
      <ServicesContext.Provider value={{ models }}>
        <App />
      </ServicesContext.Provider>
    </StoreContext.Provider>
  </StrictMode>,
);
