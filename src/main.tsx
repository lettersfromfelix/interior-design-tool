import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Repository } from "./data/repository";
import { createAppStore } from "./state/store";
import { App } from "./ui/App";
import { StoreContext } from "./ui/store";
import "./ui/styles.css";

const store = createAppStore();
void new Repository(store).start();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreContext.Provider value={store}>
      <App />
    </StoreContext.Provider>
  </StrictMode>,
);
