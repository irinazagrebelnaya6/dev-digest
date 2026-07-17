/* ModeToggle — Columns/Tabs layout switch for the Multi-Agent Review results
   page (SPEC-06 AC-13). */
"use client";

import { useTranslations } from "next-intl";
import { s } from "./styles";

export type ResultsMode = "columns" | "tabs";

export function ModeToggle({ mode, onChange }: { mode: ResultsMode; onChange: (mode: ResultsMode) => void }) {
  const t = useTranslations("multiAgent");
  return (
    <div style={s.wrap} role="group" aria-label={t("results.title")}>
      <button type="button" aria-pressed={mode === "columns"} style={s.btn(mode === "columns")} onClick={() => onChange("columns")}>
        {t("results.modeColumns")}
      </button>
      <button type="button" aria-pressed={mode === "tabs"} style={s.btn(mode === "tabs")} onClick={() => onChange("tabs")}>
        {t("results.modeTabs")}
      </button>
    </div>
  );
}
