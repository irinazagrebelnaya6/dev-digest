import type { SkillType } from "@devdigest/shared";

export const CARD_GRID_COLS = "repeat(auto-fill, minmax(280px, 1fr))";

export const TYPE_BADGE_COLOR: Record<SkillType, string> = {
  rubric: "#6366f1",
  convention: "#0ea5e9",
  security: "#ef4444",
  custom: "#8b5cf6",
};
