/* FindingDetail — Multi-Agent Review Tabs mode finding detail panel
   (SPEC-06 AC-16..18). Shows confidence, category, rationale, suggested fix,
   and the five actions: Accept, Dismiss, Learn, Turn into eval case, Reply to
   author. Self-contained (own hooks), mirroring the "self-fetching tab card"
   convention. Finding/PR text is rendered as text or via `Markdown` — never
   `dangerouslySetInnerHTML` (AC-26: agent-produced text is untrusted DATA). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  CategoryTag,
  ConfidenceNum,
  Icon,
  Markdown,
  Modal,
  MonoLink,
  SeverityBadge,
  Textarea,
  type Category,
  type Severity,
} from "@devdigest/ui";
import type { FindingActionKind, FindingRecord } from "@devdigest/shared";
import { useFindingAction } from "@/lib/hooks/reviews";
import { useCreateEvalCaseFromFinding } from "@/lib/hooks/evals";
import { useToast } from "@/lib/toast";
import { s } from "./styles";

function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.end_line !== f.start_line ? `${f.start_line}-${f.end_line}` : String(f.start_line);
}

export function FindingDetail({
  finding,
  prId,
  defaultExpanded,
}: {
  finding: FindingRecord;
  prId: string;
  defaultExpanded?: boolean;
}) {
  const t = useTranslations("prReview");
  const tm = useTranslations("multiAgent");
  const toast = useToast();
  const [expanded, setExpanded] = React.useState(!!defaultExpanded);
  const [replyOpen, setReplyOpen] = React.useState(false);
  const [replyText, setReplyText] = React.useState("");
  const [learned, setLearned] = React.useState(false);
  const action = useFindingAction();
  const createEvalCase = useCreateEvalCaseFromFinding();

  const accepted = !!finding.accepted_at;
  const dismissed = !!finding.dismissed_at;
  const canTurnIntoEvalCase = accepted || dismissed;

  const runAction = async (kind: FindingActionKind, reply?: string) => {
    try {
      await action.mutateAsync({ findingId: finding.id, action: kind, reply, prId });
      if (kind === "learn") {
        setLearned(true);
        toast.success(tm("detail.learned"));
      }
      if (kind === "reply") {
        setReplyOpen(false);
        setReplyText("");
        toast.success(tm("detail.replySent"));
      }
    } catch {
      /* surfaced via the global mutationCache.onError toast */
    }
  };

  const handleTurnIntoEvalCase = async () => {
    try {
      await createEvalCase.mutateAsync(finding.id);
      toast.success(t("finding.turnedIntoEvalCase"));
    } catch {
      /* surfaced via the global mutationCache.onError toast */
    }
  };

  return (
    <div data-finding-id={finding.id} style={s.card}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <SeverityBadge severity={finding.severity as Severity} compact />
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title}>{finding.title}</span>
            <CategoryTag category={finding.category as Category} />
          </div>
          <div style={s.metaRow}>
            {/* Untrusted (agent-derived) file path — no repo/head-sha available on
               this page, so it renders as inert mono text (no href). */}
            <MonoLink>
              {finding.file}:{lineLabel(finding)}
            </MonoLink>
            <ConfidenceNum value={finding.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{finding.rationale}</Markdown>
          </div>
          {finding.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{finding.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              active={accepted}
              disabled={action.isPending}
              onClick={() => runAction("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              active={dismissed}
              disabled={action.isPending}
              onClick={() => runAction("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon={learned ? "Check" : "Brain"}
              active={learned}
              disabled={action.isPending}
              onClick={() => runAction("learn")}
            >
              {t("finding.learn")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              disabled={!canTurnIntoEvalCase || createEvalCase.isPending}
              loading={createEvalCase.isPending}
              onClick={handleTurnIntoEvalCase}
            >
              {t("finding.turnIntoEvalCase")}
            </Button>
            <Button kind="ghost" size="sm" icon="MessageSquare" onClick={() => setReplyOpen(true)}>
              {t("finding.replyToAuthor")}
            </Button>
          </div>
        </div>
      )}

      {replyOpen && (
        <Modal
          title={tm("detail.replyTitle")}
          onClose={() => setReplyOpen(false)}
          footer={
            <div style={s.replyFooter}>
              <Button kind="ghost" onClick={() => setReplyOpen(false)}>
                {t("finding.cancel")}
              </Button>
              <Button
                kind="primary"
                disabled={!replyText.trim() || action.isPending}
                loading={action.isPending}
                onClick={() => runAction("reply", replyText)}
              >
                {t("finding.sendReply")}
              </Button>
            </div>
          }
        >
          <Textarea value={replyText} onChange={setReplyText} placeholder={t("finding.replyPlaceholder")} rows={5} />
        </Modal>
      )}
    </div>
  );
}
