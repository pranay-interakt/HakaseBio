import { useState, useEffect } from "react";
import { isReady } from "./chemistry";

export function useRDKitReady(): boolean {
  const [ready, setReady] = useState(isReady);

  useEffect(() => {
    if (ready) return;
    const iv = setInterval(() => {
      if (isReady()) {
        setReady(true);
        clearInterval(iv);
      }
    }, 80);
    return () => clearInterval(iv);
  }, [ready]);

  return ready;
}
