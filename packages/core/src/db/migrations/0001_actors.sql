-- Actors are humans, agents and system processes as distinct actors of one model (DATA-03).
-- Every mutation and every event row carries an actor_id — this table exists from the very
-- first migration so team collaboration (TEAM-01) is additive later, not structural.
CREATE TABLE actors (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    type TEXT NOT NULL CHECK (type IN ('human', 'agent', 'system')),
    display_name TEXT NOT NULL,
    auth_ref TEXT,
    created_at TEXT NOT NULL
);

-- Seed the system actor and a default local human actor. Literal ULID values keep this
-- migration deterministic across every machine it runs on.
INSERT INTO actors (id, type, display_name, auth_ref, created_at) VALUES
    ('01M21VR17BZ33DG1X564KV0YEW', 'system', 'Flywheel', NULL, '2026-09-09T00:00:00.000Z'),
    ('01M21VR17C2SKYJMVH3P3DFJBW', 'human', 'Local User', NULL, '2026-09-09T00:00:00.000Z');
