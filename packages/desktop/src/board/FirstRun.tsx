/**
 * The zero-projects empty state (01-UI-SPEC.md "State Inventory"; critique F4, issue #210): Empty on the
 * floor, with the HighKnow mark, one line, and Register project… as the filled primary.
 *
 * Registration is two steps: pick a folder via the native picker, then confirm a project key prefix in
 * `RegisterProjectDialog`, pre-filled with a default derived from the folder's name and editable before the
 * first item exists (01-UI-SPEC.md Open Decisions #11). Once the project has allocated its first item key,
 * the prefix becomes immutable (`packages/core::domain::project::update_key_prefix` enforces this).
 */
import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { openFolderDialog } from "../adapters/tauri";
import logoUrl from "../assets/logo.svg";
import { RegisterProjectDialog, folderName, type PendingRegistration } from "../projects/RegisterProjectFlow";
import { Button } from "@/components/Button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@highknow/design";
import { LaunchEnvironmentNotice } from "./LaunchEnvironmentNotice";

export { deriveKeyPrefix } from "../projects/RegisterProjectFlow";

export function FirstRun() {
  const [pending, setPending] = useState<PendingRegistration | null>(null);

  async function handlePickFolder() {
    const repoPath = await openFolderDialog();
    if (!repoPath) return;
    setPending({ repoPath, name: folderName(repoPath) });
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* A missing `claude` is said here too, in the flow above the floor, never over it (critique F6). */}
      <LaunchEnvironmentNotice />
      <Empty className="min-h-0">
        <EmptyHeader className="max-w-md gap-3">
          <EmptyMedia>
            {/* The HighKnow mark in its real colours (issue #196): the #3c64dd tile with the white glyph, the
                same in both schemes, as HighKnow's Wordmark draws it. An image cannot read the page's tokens,
                which is the point. A reference to a static file, never inline markup (T-08.1-05). */}
            <img src={logoUrl} alt="Flywheel by HighKnow" className="block size-16 shrink-0" />
          </EmptyMedia>
          <EmptyTitle>
            <h1 className="m-0 text-title font-semibold tracking-tight">No projects yet</h1>
          </EmptyTitle>
          <EmptyDescription className="text-body">
            Register a local git repository to see its board. Flywheel keeps the board in its own database and writes
            only a small marker file into the repository.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="lg" onClick={() => void handlePickFolder()}>
            <FolderPlus aria-hidden="true" />
            Register project…
          </Button>
        </EmptyContent>
      </Empty>
      <RegisterProjectDialog
        pending={pending}
        onOpenChange={(open) => !open && setPending(null)}
        onChooseAnother={() => void handlePickFolder()}
      />
    </div>
  );
}
