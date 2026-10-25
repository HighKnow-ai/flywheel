/**
 * The review card's changed files (docs/mvp-spec.md §8, issues #157 and #207): every file of the review's diff
 * (`base_sha...` the branch's head now, `git::review_files`), each a Collapsible whose patch is read one file
 * at a time (`review_file_patch`) and drawn with `react-diff-view` in the unified view.
 *
 * A patch is read only while its file is open, keyed by the branch's head so a new commit reads it again.
 * While the new head's patch is read the previous one stays drawn (issue #195), so a commit never blanks
 * an open diff to "Reading the diff…".
 * A short diff opens every file; one of more than {@link OPEN_BY_DEFAULT_MAX} files starts folded, so the card
 * never reads twenty patches at once and Merge is not pushed past them. A diff of more than
 * {@link INDEX_MIN} files has a file index above the diffs: each entry opens its file and takes the Developer
 * to it. Expand all and Collapse all sit beside the heading. A binary file and a patch past the core's size
 * limit say so instead of drawing.
 */
import { useId, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Decoration, Diff, Hunk, parseDiff } from "react-diff-view";
import "react-diff-view/style/index.css";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, FileCode } from "lucide-react";
import { reviewFilePatch, type ReviewFileDto } from "../adapters/tauri";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/** The most files a diff may have for every file to open by default: past it, every diff starts folded. */
export const OPEN_BY_DEFAULT_MAX = 5;

/** A diff with more files than this gets the file index above the diffs. */
export const INDEX_MIN = 3;

/** git's status letter in words. */
const STATUS_WORDS: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fileKey(file: ReviewFileDto): string {
  return `${file.oldPath ?? ""}\u0000${file.path}`;
}

function PatchView({ path, patch }: { path: string; patch: string }) {
  const file = useMemo(() => parseDiff(patch)[0], [patch]);
  if (!file || file.hunks.length === 0) {
    return <p className="m-0 px-3 py-2 text-meta text-muted-foreground">No line changes: only the file's mode or name changed.</p>;
  }
  return (
    <div role="group" aria-label={`Diff of ${path}`} className="review-diff overflow-x-auto">
      <Diff viewType="unified" diffType={file.type} hunks={file.hunks}>
        {(hunks) =>
          hunks.flatMap((hunk) => [
            <Decoration key={`header ${hunk.content}`}>{hunk.content}</Decoration>,
            <Hunk key={`hunk ${hunk.content}`} hunk={hunk} />,
          ])
        }
      </Diff>
    </div>
  );
}

function FilePatch({ projectId, storyId, headSha, file }: { projectId: string; storyId: string; headSha: string | null; file: ReviewFileDto }) {
  const query = useQuery({
    queryKey: ["board", projectId, "review", storyId, "patch", headSha, file.oldPath, file.path],
    queryFn: () => reviewFilePatch(storyId, file.path, file.oldPath),
    staleTime: Infinity,
    // A new head is a new key: keep this file's previous patch on screen until the new one arrives.
    placeholderData: keepPreviousData,
  });
  if (query.isPending) return <p className="m-0 px-3 py-2 text-meta text-muted-foreground">Reading the diff…</p>;
  if (query.isError) {
    return (
      <p role="alert" className="m-0 px-3 py-2 text-small text-destructive-text">
        {errorText(query.error)}
      </p>
    );
  }
  if (query.data.tooLarge) {
    return (
      <p className="m-0 px-3 py-2 text-meta text-muted-foreground">
        This file's diff is too large to show here (over 512 KB). Read it in your editor.
      </p>
    );
  }
  return <PatchView path={file.path} patch={query.data.patch} />;
}

function LineCounts({ file }: { file: ReviewFileDto }) {
  return <span className="shrink-0 font-mono text-meta tabular-nums text-muted-foreground">{`+${file.added ?? 0} −${file.removed ?? 0}`}</span>;
}

const ROW_HEADER = "flex w-full min-w-0 items-center gap-2 bg-muted px-3 py-1.5 text-left";

function FileRow({
  id,
  projectId,
  storyId,
  headSha,
  file,
  open,
  onOpenChange,
}: {
  id: string;
  projectId: string;
  storyId: string;
  headSha: string | null;
  file: ReviewFileDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const status = STATUS_WORDS[file.status] ?? file.status;
  const header = (
    <>
      <code className="min-w-0 truncate font-mono text-meta text-foreground" title={file.path}>
        {file.path}
      </code>
      {file.oldPath && (
        <span className="min-w-0 truncate text-meta text-muted-foreground" title={file.oldPath}>
          {`from ${file.oldPath}`}
        </span>
      )}
      <span className="ml-auto shrink-0 text-meta text-muted-foreground">{status}</span>
    </>
  );

  if (file.binary) {
    return (
      <li id={id} className="scroll-mt-4 overflow-hidden rounded-md border border-border">
        <div className={ROW_HEADER}>
          <FileCode aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {header}
        </div>
        <p className="m-0 border-t border-border px-3 py-2 text-meta text-muted-foreground">Binary file: not shown.</p>
      </li>
    );
  }

  return (
    <Collapsible asChild open={open} onOpenChange={onOpenChange}>
      <li id={id} className="scroll-mt-4 overflow-hidden rounded-md border border-border">
        <CollapsibleTrigger className={cn(ROW_HEADER, "transition-colors hover:bg-accent")}>
          <ChevronRight
            aria-hidden="true"
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          />
          {header}
          <LineCounts file={file} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border bg-card">
            <FilePatch projectId={projectId} storyId={storyId} headSha={headSha} file={file} />
          </div>
        </CollapsibleContent>
      </li>
    </Collapsible>
  );
}

/**
 * The file index: one line per changed file, two columns once the card is wide enough. An entry opens its
 * file, scrolls it to the top and gives its header the focus, so the keyboard lands where the eye does.
 */
function FileIndex({ files, rowId, onGo }: { files: ReviewFileDto[]; rowId: (index: number) => string; onGo: (index: number) => void }) {
  return (
    <nav aria-label="File index">
      <ul className="m-0 grid min-w-0 list-none grid-cols-1 gap-x-4 p-0 @2xl:grid-cols-2">
        {files.map((file, index) => (
          <li key={fileKey(file)} className="min-w-0">
            <a
              href={`#${rowId(index)}`}
              onClick={(event) => {
                event.preventDefault();
                onGo(index);
              }}
              className="flex min-w-0 items-center gap-2 rounded-sm px-2 py-1 text-meta transition-colors hover:bg-accent"
            >
              <code title={file.path} className="min-w-0 flex-1 truncate font-mono text-foreground">
                {file.path}
              </code>
              {file.binary ? (
                <span className="shrink-0 text-meta text-muted-foreground">Binary</span>
              ) : (
                <LineCounts file={file} />
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ReviewFiles({
  projectId,
  storyId,
  headSha,
  files,
}: {
  projectId: string;
  storyId: string;
  headSha: string | null;
  files: ReviewFileDto[];
}) {
  const label = `${files.length} changed ${files.length === 1 ? "file" : "files"}`;
  const baseId = useId();
  const rowId = (index: number) => `${baseId}-file-${index}`;
  const openable = files.filter((file) => !file.binary).map(fileKey);
  const [open, setOpen] = useState<Set<string>>(() => new Set(files.length <= OPEN_BY_DEFAULT_MAX ? openable : []));
  const allOpen = openable.length > 0 && openable.every((key) => open.has(key));

  function setFileOpen(key: string, next: boolean) {
    setOpen((current) => {
      const copy = new Set(current);
      if (next) copy.add(key);
      else copy.delete(key);
      return copy;
    });
  }

  function go(index: number) {
    const file = files[index];
    if (!file) return;
    if (!file.binary) setFileOpen(fileKey(file), true);
    requestAnimationFrame(() => {
      const row = document.getElementById(rowId(index));
      row?.scrollIntoView?.({ block: "start" });
      row?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    });
  }

  return (
    <section aria-label={label} className="@container flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="m-0 text-small font-semibold">{label}</h3>
        {openable.length > 1 && (
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setOpen(new Set(allOpen ? [] : openable))}>
            {allOpen ? <ChevronsDownUp aria-hidden="true" /> : <ChevronsUpDown aria-hidden="true" />}
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        )}
      </div>
      {files.length > INDEX_MIN && <FileIndex files={files} rowId={rowId} onGo={go} />}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {files.map((file, index) => (
          <FileRow
            key={fileKey(file)}
            id={rowId(index)}
            projectId={projectId}
            storyId={storyId}
            headSha={headSha}
            file={file}
            open={open.has(fileKey(file))}
            onOpenChange={(next) => setFileOpen(fileKey(file), next)}
          />
        ))}
      </ul>
    </section>
  );
}
