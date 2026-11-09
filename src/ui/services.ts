import { createContext, useContext } from "react";
import type { LayoutManager } from "../data/layouts";
import type { ModelLibrary } from "../engine/items/models";

/** Long-lived services shared by the 3D view, the thumbnails and the layout menu (created once in main.tsx). */
export interface Services {
  models: ModelLibrary;
  layouts: LayoutManager;
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("ServicesContext is missing");
  return services;
}
