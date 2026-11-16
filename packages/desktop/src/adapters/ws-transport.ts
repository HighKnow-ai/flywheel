/**
 * The second transport behind `adapters/tauri.ts`, for the end-to-end harness only: the same
 * `invoke` and `listen` calls, carried over the WebSocket the headless core serves
 * (`src-tauri/src/bin/flywheel-headless.rs`, which documents the frames).
 *
 * It is reached only through a dynamic import behind `import.meta.env.VITE_FLYWHEEL_E2E === "1"`, a
 * flag Vite replaces with a literal at build time. A production build therefore drops this module
 * and its chunk, and `scripts/release/check-release-bundle.mjs` fails the build if a trace of it
 * (the marker below) remains.
 *
 * Where to connect comes from the page URL (`?flywheelCore=<port>&flywheelToken=<token>`), which the
 * harness sets per run, and is kept in `sessionStorage` so a reload of the page still finds it.
 */

/** The string the release check looks for. Do not change it without changing the check. */
export const WS_TRANSPORT_MARKER = "flywheel-e2e-ws-transport";

export interface WsTransport {
  invoke<TResult>(command: string, args?: Record<string, unknown>): Promise<TResult>;
  /** Subscribe to a core event; the returned function unsubscribes. */
  listen<TPayload>(event: string, handler: (payload: TPayload) => void): () => void;
}

interface Reply {
  id?: number;
  ok?: unknown;
  err?: unknown;
  event?: string;
  payload?: unknown;
}

const STORAGE_KEY = WS_TRANSPORT_MARKER;

/** `{ port, token }` from the page URL, or from the tab's own earlier visit. */
function coreAddress(): { port: string; token: string } {
  const query = new URLSearchParams(window.location.search);
  const port = query.get("flywheelCore");
  const token = query.get("flywheelToken");
  if (port && token) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ port, token }));
    } catch {
      // A page that cannot keep it is reloaded with the query string anyway.
    }
    return { port, token };
  }
  try {
    const kept = window.sessionStorage.getItem(STORAGE_KEY);
    if (kept) return JSON.parse(kept) as { port: string; token: string };
  } catch {
    // Fall through to the error below.
  }
  throw new Error("the e2e transport needs ?flywheelCore=<port>&flywheelToken=<token> in the page URL");
}

let connection: Promise<WsTransport> | null = null;

/** The one connection of this page, opened on first use. */
export function connectWsTransport(): Promise<WsTransport> {
  connection ??= open();
  return connection;
}

function open(): Promise<WsTransport> {
  const { port, token } = coreAddress();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: never) => void; reject: (reason: unknown) => void }>();
  const handlers = new Map<string, Set<(payload: never) => void>>();

  socket.addEventListener("message", (message) => {
    const reply = JSON.parse(String(message.data)) as Reply;
    if (reply.event !== undefined) {
      for (const handler of handlers.get(reply.event) ?? []) handler(reply.payload as never);
      return;
    }
    const call = reply.id === undefined ? undefined : pending.get(reply.id);
    if (!call || reply.id === undefined) return;
    pending.delete(reply.id);
    // Tauri's `invoke` rejects with the command's own error value; so does this.
    if ("err" in reply) call.reject(reply.err);
    else call.resolve(reply.ok as never);
  });
  socket.addEventListener("close", () => {
    for (const call of pending.values()) call.reject("the headless core closed the connection");
    pending.clear();
  });

  const transport: WsTransport = {
    invoke<TResult>(command: string, args?: Record<string, unknown>): Promise<TResult> {
      return new Promise<TResult>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: resolve as (value: never) => void, reject });
        socket.send(JSON.stringify({ id, cmd: command, args: args ?? {} }));
      });
    },
    listen<TPayload>(event: string, handler: (payload: TPayload) => void): () => void {
      const set = handlers.get(event) ?? new Set();
      handlers.set(event, set);
      set.add(handler as (payload: never) => void);
      return () => set.delete(handler as (payload: never) => void);
    },
  };

  return new Promise<WsTransport>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(transport), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("could not reach the headless core (wrong port or token?)")),
      {
        once: true,
      },
    );
  });
}
