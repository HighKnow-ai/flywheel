/**
 * The review card's changed files (docs/mvp-spec.md §8, issue #157): every file of the review's diff
 * (`base_sha...` the branch's head now, `git::review_files`), each a disclosure whose patch is read one
 * file at a time (`review_file_patch`) and drawn with `react-diff-view` in the unified view.
 *
 * A patch is read only while its file is open, keyed by the branch's head so a new commit reads it again.
 * Every file opens by default; a diff of more than {@link OPEN_BY_DEFAULT_MAX} files starts folded, so the
 * card never reads fifty patches at once. A binary file and a patch past the core's size limit say so
 * instead of drawing.
 */
import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Decoration, Diff, Hunk, parseDiff } from "react-diff-view";
import "react-diff-view/style/index.css";
import { ChevronRight, FileCode } from "lucide-react";
import { reviewFilePatch, type ReviewFileDto } from "../adapters/tauri";
import { cn } from "@/lib/utils";

/** The most files a diff may have for every file to open by default. */
export const OPEN_BY_DEFAULT_MAX = 12;

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

function FileRow({
  projectId,
  storyId,
  headSha,
  file,
  defaultOpen,
}: {
  projectId: string;
  storyId: string;
  headSha: string | null;
  file: ReviewFileDto;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen && !file.binary);
  const status = STATUS_WORDS[file.status] ?? file.status;
  const bodyId = useId();
  return (
    <li className="overflow-hidden rounded-md border border-border">
      <button
        type="button"
        aria-expanded={file.binary ? undefined : open}
        aria-controls={file.binary ? undefined : bodyId}
        disabled={file.binary}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 bg-muted px-3 py-1.5 text-left transition-colors duration-(--duration-state) hover:bg-accent disabled:cursor-default disabled:hover:bg-muted"
      >
        {file.binary ? (
          <FileCode aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight
            aria-hidden="true"
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-state)", open && "rotate-90")}
          />
        )}
        <code className="min-w-0 truncate font-mono text-meta text-foreground" title={file.path}>
          {file.path}
        </code>
        {file.oldPath && (
          <span className="min-w-0 truncate text-meta text-muted-foreground" title={file.oldPath}>
            {`from ${file.oldPath}`}
          </span>
        )}
        <span className="ml-auto shrink-0 text-meta text-muted-foreground">{status}</span>
        {!file.binary && (
          <span className="shrink-0 font-mono text-meta tabular-nums text-muted-foreground">{`+${file.added ?? 0} −${file.removed ?? 0}`}</span>
        )}
      </button>
      {file.binary && <p className="m-0 border-t border-border px-3 py-2 text-meta text-muted-foreground">Binary file: not shown.</p>}
      {!file.binary && open && (
        <div id={bodyId} className="border-t border-border bg-card">
          <FilePatch projectId={projectId} storyId={storyId} headSha={headSha} file={file} />
        </div>
      )}
    </li>
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
  const openByDefault = files.length <= OPEN_BY_DEFAULT_MAX;
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <h3 className="m-0 text-small font-semibold">{label}</h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {files.map((file) => (
          <FileRow
            key={`${file.oldPath ?? ""}\u0000${file.path}`}
            projectId={projectId}
            storyId={storyId}
            headSha={headSha}
            file={file}
            defaultOpen={openByDefault}
          />
        ))}
      </ul>
    </section>
  );
}
