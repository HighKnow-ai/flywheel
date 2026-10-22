/// <reference types="vite/client" />
/**
 * Dev-only entry for `critique.html` (issue #102): mounts the real app over the seeded fake backend, so
 * the screens can be opened in any browser or scanned by a URL-based design detector. Query parameters
 * open a surface straight away: `?session=<sessionId>&story=<storyId>`, `?story=<storyId>` (the Story view) or
 * `?fleet=fleet|queue`.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "../../App";
import { useUiStore } from "../../state/uiStore";
import { installFixtureBackend } from "./m2-fixture";

installFixtureBackend();

const params = new URLSearchParams(window.location.search);
const session = params.get("session");
const fleet = params.get("fleet");
const story = params.get("story");
if (session) useUiStore.getState().setActiveSessionId(session, story);
else if (story) useUiStore.getState().openStory(params.get("project") ?? "p-fly", story);
if (fleet === "fleet" || fleet === "queue") useUiStore.getState().setFleetSurface({ view: fleet });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
