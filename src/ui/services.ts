import { createContext, useContext } from "react";
import type { ModelLibrary } from "../engine/items/models";

/** Long-lived services shared by the 3D view and the thumbnails (created once in main.tsx). */
export interface Services {
  models: ModelLibrary;
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("ServicesContext is missing");
  return services;
}
