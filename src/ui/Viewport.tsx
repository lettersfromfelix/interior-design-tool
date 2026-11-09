import { useEffect, useRef } from "react";
import { Engine } from "../engine/Engine";
import { useAppStore } from "./store";

/** Hosts the Three.js engine. The engine reads everything it needs from the store. */
export function Viewport() {
  const store = useAppStore();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const engine = new Engine(ref.current!, store);
    return () => engine.dispose();
  }, [store]);
  return <div className="viewport" ref={ref} />;
}
