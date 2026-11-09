import type { Check } from "./schema/apartment";

export const formatCheckValue = (value: number, unit: Check["unit"]): string =>
  unit === "deg" ? `${value.toFixed(0)}°` : `${value.toFixed(1)} cm`;
