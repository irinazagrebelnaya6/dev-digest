/* ProjectContextView — "Project Context" screen.
   SPEC-01 (Feature 1): read/preview of every `.md` discovered under
   specs/docs/insights in the reviewed repo's clone (path + type badge +
   "Used by N agents"), with a markdown preview of the selected doc.
   SPEC-02 (editing & toolbar): adds an authoring toolbar (New doc, New
   folder, Upload, Refresh, Open + active-root label, AC-1) and a right-pane
   Preview | Edit toggle with Save (AC-2/AC-3/AC-4). Writes land only in the
   repo clone's working tree on disk (no git action) — see `writer.ts` on the
   server. A stale-hash or path-collision Save is rejected with 409; the
   client never silently clobbers — it keeps the edit buffer and offers
   Reload/Overwrite (AC-13/AC-16). All write controls are disabled while the
   repo has no writable clone (the SPEC-01 degraded state, AC-17). Preview
   still renders via `react-markdown` **without** `rehype-raw` (AC-14) — the
   `Markdown` primitive never executes embedded HTML/scripts.
   Self-fetching via `useProjectContext(repoId)` — no props besides repoId. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Markdown, Skeleton } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import {
  useCreateContextFolder,
  useProjectContext,
  useUploadContextDoc,
  useWriteContextDoc,
  type ProjectContextDoc,
} from "@/lib/hooks/project-context";
import { s } from "./styles";

type ViewMode = "preview" | "edit";

function apiErrorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Unexpected error";
}

export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("projectContext");
  const { data, isLoading, isError, refetch } = useProjectContext(repoId);
  const writeDoc = useWriteContextDoc(repoId);
  const uploadDoc = useUploadContextDoc(repoId);
  const createFolder = useCreateContextFolder(repoId);

  const docs = data?.docs ?? [];
  // Degraded === no writable clone yet (SPEC-01's un-cloned state) — the
  // service returns `degraded: true` ONLY in that case (AC-17).
  const canWrite = !data?.degraded;

  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const selected: ProjectContextDoc | null = docs.find((d) => d.path === selectedPath) ?? docs[0] ?? null;

  const roots = React.useMemo(
    () => Array.from(new Set(docs.map((d) => d.badge))).sort(),
    [docs],
  );
  const activeRoot = selected?.badge ?? roots[0] ?? "specs";

  // ---- Preview | Edit + Save (AC-2/AC-3/AC-4/AC-13/AC-16) ----
  const [mode, setMode] = React.useState<ViewMode>("preview");
  const [buffer, setBuffer] = React.useState("");
  const [loadedHash, setLoadedHash] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<{ kind: "hash" | "collision"; message: string } | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const loadedPathRef = React.useRef<string | null>(null);

  // Re-seed the edit buffer from the freshly-loaded doc only when the
  // SELECTED path changes (new selection) — never on every render, or a
  // dirty in-progress edit would be clobbered under the user while typing.
  React.useEffect(() => {
    if (!selected) return;
    if (loadedPathRef.current === selected.path) return;
    loadedPathRef.current = selected.path;
    setBuffer(selected.content ?? "");
    setLoadedHash(selected.hash ?? null);
    setMode("preview");
    setConflict(null);
    setSaveError(null);
  }, [selected]);

  const dirty = mode === "edit" && buffer !== (selected?.content ?? "");

  function selectDoc(path: string) {
    setSelectedPath(path);
  }

  function handleSave(opts?: { overwriteAnyway?: boolean }) {
    if (!selected || !canWrite) return;
    setSaveError(null);
    writeDoc.mutate(
      opts?.overwriteAnyway
        ? { path: selected.path, content: buffer, overwrite: true }
        : { path: selected.path, content: buffer, hash: loadedHash },
      {
        onSuccess: (result) => {
          loadedPathRef.current = result.doc.path;
          setLoadedHash(result.doc.hash ?? null);
          setConflict(null);
          setSaveError(null);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            setConflict({
              kind: loadedHash ? "hash" : "collision",
              message: apiErrorMessage(err),
            });
          } else {
            setSaveError(apiErrorMessage(err));
          }
        },
      },
    );
  }

  async function handleReloadLatest() {
    const res = await refetch();
    const fresh = res.data?.docs.find((d) => d.path === selected?.path);
    if (fresh) {
      loadedPathRef.current = fresh.path;
      setBuffer(fresh.content ?? "");
      setLoadedHash(fresh.hash ?? null);
    }
    setConflict(null);
  }

  // ---- Toolbar: New doc / New folder / Upload (AC-1/AC-10/AC-11) ----
  const [newDocOpen, setNewDocOpen] = React.useState(false);
  const [newDocPath, setNewDocPath] = React.useState("");
  const [newDocError, setNewDocError] = React.useState<string | null>(null);

  const [newFolderOpen, setNewFolderOpen] = React.useState(false);
  const [newFolderPath, setNewFolderPath] = React.useState("");
  const [newFolderError, setNewFolderError] = React.useState<string | null>(null);

  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function openNewDoc() {
    setNewFolderOpen(false);
    setNewDocError(null);
    setNewDocPath(`${activeRoot}/`);
    setNewDocOpen(true);
  }

  function submitNewDoc() {
    const path = newDocPath.trim();
    if (!path) return;
    writeDoc.mutate(
      { path, content: `# ${path.split("/").pop()?.replace(/\.md$/i, "") ?? "New doc"}\n` },
      {
        onSuccess: (result) => {
          setSelectedPath(result.doc.path);
          loadedPathRef.current = result.doc.path;
          setBuffer(result.doc.content ?? "");
          setLoadedHash(result.doc.hash ?? null);
          setMode("edit");
          setNewDocOpen(false);
          setNewDocPath("");
        },
        onError: (err) => setNewDocError(apiErrorMessage(err)),
      },
    );
  }

  function openNewFolder() {
    setNewDocOpen(false);
    setNewFolderError(null);
    setNewFolderPath(`${activeRoot}/`);
    setNewFolderOpen(true);
  }

  function submitNewFolder() {
    const path = newFolderPath.trim();
    if (!path) return;
    createFolder.mutate(
      { path },
      {
        onSuccess: () => {
          setNewFolderOpen(false);
          setNewFolderPath("");
        },
        onError: (err) => setNewFolderError(apiErrorMessage(err)),
      },
    );
  }

  function triggerUpload() {
    setUploadError(null);
    fileInputRef.current?.click();
  }

  function onUploadFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      const path = `${activeRoot}/${file.name}`;
      uploadDoc.mutate(
        { path, content },
        {
          onSuccess: (result) => setSelectedPath(result.doc.path),
          onError: (err) => setUploadError(apiErrorMessage(err)),
        },
      );
    };
    reader.readAsText(file);
  }

  function openSelectedForEdit() {
    if (!selected) return;
    setMode("edit");
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.h1}>{t("title")}</h1>
        <p style={s.subtitle}>{t("subtitle")}</p>
      </div>

      {data?.degraded && (
        <div style={s.banner}>
          <Icon.AlertTriangle size={14} />
          <span>{data.reason ? t("degradedWithReason", { reason: data.reason }) : t("degraded")}</span>
        </div>
      )}

      {!isLoading && !isError && (
        <div style={s.toolbar}>
          <Button kind="secondary" size="sm" icon="Plus" disabled={!canWrite} onClick={openNewDoc}>
            {t("toolbar.newDoc")}
          </Button>
          <Button kind="secondary" size="sm" icon="Folder" disabled={!canWrite} onClick={openNewFolder}>
            {t("toolbar.newFolder")}
          </Button>
          <Button kind="secondary" size="sm" icon="Upload" disabled={!canWrite} onClick={triggerUpload}>
            {t("toolbar.upload")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md"
            style={s.visuallyHidden}
            aria-hidden="true"
            tabIndex={-1}
            onChange={onUploadFileChosen}
          />
          <Button kind="ghost" size="sm" icon="RefreshCw" onClick={() => refetch()}>
            {t("toolbar.refresh")}
          </Button>
          <Button kind="ghost" size="sm" icon="ExternalLink" disabled={!selected} onClick={openSelectedForEdit}>
            {t("toolbar.open")}
          </Button>
          <span style={s.toolbarSpacer} />
          <span style={s.rootLabel} aria-label={t("toolbar.rootLabel")}>
            <Icon.Folder size={12} />
            {roots.length > 1
              ? roots.map((r) => (
                  <span key={r} style={r === activeRoot ? { ...s.rootPill, ...s.rootPillActive } : s.rootPill}>
                    {r}/
                  </span>
                ))
              : `${activeRoot}/`}
          </span>
        </div>
      )}

      {newDocOpen && (
        <div style={s.inlineForm}>
          <input
            style={s.inlineInput}
            aria-label={t("toolbar.newDocPathLabel")}
            placeholder={t("toolbar.newDocPathPlaceholder")}
            value={newDocPath}
            onChange={(e) => setNewDocPath(e.target.value)}
            autoFocus
          />
          <Button kind="primary" size="sm" onClick={submitNewDoc} loading={writeDoc.isPending}>
            {t("toolbar.newDocCreate")}
          </Button>
          <Button kind="ghost" size="sm" onClick={() => setNewDocOpen(false)}>
            {t("toolbar.cancel")}
          </Button>
          {newDocError && <p style={s.inlineError}>{newDocError}</p>}
        </div>
      )}

      {newFolderOpen && (
        <div style={s.inlineForm}>
          <input
            style={s.inlineInput}
            aria-label={t("toolbar.newFolderPathLabel")}
            placeholder={t("toolbar.newFolderPathPlaceholder")}
            value={newFolderPath}
            onChange={(e) => setNewFolderPath(e.target.value)}
            autoFocus
          />
          <Button kind="primary" size="sm" onClick={submitNewFolder} loading={createFolder.isPending}>
            {t("toolbar.newFolderCreate")}
          </Button>
          <Button kind="ghost" size="sm" onClick={() => setNewFolderOpen(false)}>
            {t("toolbar.cancel")}
          </Button>
          {newFolderError && <p style={s.inlineError}>{newFolderError}</p>}
        </div>
      )}

      {uploadError && <p style={s.inlineError}>{t("toolbar.uploadError", { message: uploadError })}</p>}

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={16} width="60%" />
          <Skeleton height={80} />
        </div>
      )}

      {isError && <ErrorState body={t("loadError")} onRetry={() => refetch()} />}

      {!isLoading && !isError && docs.length === 0 && (
        <EmptyState icon="FileText" title={t("emptyTitle")} body={t("emptyBody")} />
      )}

      {!isLoading && !isError && docs.length > 0 && (
        <div style={s.split}>
          <div style={s.listCol} role="list" aria-label={t("listLabel")}>
            {docs.map((doc) => {
              const active = selected?.path === doc.path;
              return (
                <button
                  key={doc.path}
                  type="button"
                  role="listitem"
                  onClick={() => selectDoc(doc.path)}
                  aria-pressed={active}
                  style={active ? { ...s.row, ...s.rowActive } : s.row}
                >
                  <div style={s.rowTop}>
                    <Icon.FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <span style={s.path}>{doc.path}</span>
                    <span style={s.badge}>{doc.badge}</span>
                  </div>
                  <span style={s.usedBy}>
                    <Icon.Users size={12} />
                    {t("usedBy", { count: doc.used_by })}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={s.detailCol}>
            {selected ? (
              <>
                <div style={s.detailHeader}>
                  <Icon.FileText size={16} style={{ color: "var(--text-muted)" }} />
                  <span style={s.detailPath}>{selected.path}</span>
                  <span style={s.badge}>{selected.badge}</span>
                  <span style={s.usedBy}>
                    <Icon.Users size={12} />
                    {t("usedBy", { count: selected.used_by })}
                  </span>
                  <div style={s.modeRow} role="group" aria-label={t("editor.modeLabel")}>
                    <Button
                      kind="tertiary"
                      size="sm"
                      icon="Eye"
                      active={mode === "preview"}
                      aria-pressed={mode === "preview"}
                      onClick={() => setMode("preview")}
                    >
                      {t("editor.previewTab")}
                    </Button>
                    <Button
                      kind="tertiary"
                      size="sm"
                      icon="Edit"
                      active={mode === "edit"}
                      aria-pressed={mode === "edit"}
                      onClick={() => setMode("edit")}
                    >
                      {t("editor.editTab")}
                    </Button>
                  </div>
                </div>

                <div style={s.detailBody}>
                  {mode === "preview" ? (
                    selected.content ? (
                      <Markdown>{selected.content}</Markdown>
                    ) : (
                      <p style={s.noPreview}>{t("noPreview")}</p>
                    )
                  ) : (
                    <div style={s.editorWrap}>
                      {!canWrite && <p style={s.saveHint}>{t("editor.noWritableClone")}</p>}
                      <textarea
                        style={s.textarea}
                        aria-label={t("editor.editAriaLabel", { path: selected.path })}
                        value={buffer}
                        onChange={(e) => setBuffer(e.target.value)}
                        disabled={!canWrite}
                        spellCheck={false}
                      />
                      <div style={s.saveRow}>
                        <Button
                          kind="primary"
                          size="sm"
                          icon="Check"
                          disabled={!canWrite || !dirty}
                          loading={writeDoc.isPending}
                          onClick={() => handleSave()}
                        >
                          {t("editor.save")}
                        </Button>
                        {dirty && canWrite && <span style={s.saveHint}>{t("editor.unsavedHint")}</span>}
                      </div>
                      {saveError && <p style={s.inlineError}>{t("editor.genericError", { message: saveError })}</p>}
                      {conflict && (
                        <div role="alert" style={s.conflictBanner}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Icon.AlertTriangle size={14} />
                            <strong>
                              {conflict.kind === "hash" ? t("editor.conflictTitle") : t("editor.collisionTitle")}
                            </strong>
                          </div>
                          <span>
                            {conflict.kind === "hash" ? t("editor.conflictBody") : t("editor.collisionBody")}
                          </span>
                          <div style={s.conflictActions}>
                            <Button kind="secondary" size="sm" icon="RefreshCw" onClick={handleReloadLatest}>
                              {t("editor.reload")}
                            </Button>
                            <Button kind="danger" size="sm" onClick={() => handleSave({ overwriteAnyway: true })}>
                              {t("editor.overwrite")}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p style={s.noPreview}>{t("selectPrompt")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
