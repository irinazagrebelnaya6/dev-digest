import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  cards: { display: "flex", gap: 14 } satisfies CSSProperties,
  bars: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
};
