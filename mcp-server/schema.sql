-- WCAG 2.2 MCP Server — Database Schema
--
-- Three tables:
--   criteria    — the 87 WCAG 2.2 success criteria
--   techniques  — WCAG sufficient/advisory techniques (G, H, ARIA, F series)
--   axe_mapping — maps axe-core rule IDs to WCAG success criteria

CREATE TABLE IF NOT EXISTS criteria (
    id TEXT PRIMARY KEY,          -- e.g. "1.1.1"
    title TEXT NOT NULL,          -- e.g. "Non-text Content"
    level TEXT NOT NULL,          -- "A", "AA", or "AAA"
    guideline TEXT NOT NULL,      -- parent guideline, e.g. "1.1 Text Alternatives"
    principle TEXT NOT NULL,      -- "Perceivable", "Operable", "Understandable", "Robust"
    intent TEXT NOT NULL,         -- why this criterion exists (plain language)
    benefits TEXT NOT NULL,       -- who benefits and how
    sufficient_techniques TEXT,   -- comma-separated technique IDs
    failure_techniques TEXT       -- comma-separated failure technique IDs
);

CREATE TABLE IF NOT EXISTS techniques (
    id TEXT PRIMARY KEY,          -- e.g. "G18", "H44", "ARIA16", "F65"
    title TEXT NOT NULL,
    technology TEXT NOT NULL,     -- "general", "html", "css", "aria", "script", "failure"
    description TEXT NOT NULL,    -- what the technique does
    procedure TEXT,               -- how to test for it
    examples TEXT                 -- code examples or patterns
);

CREATE TABLE IF NOT EXISTS axe_mapping (
    axe_rule_id TEXT NOT NULL,    -- e.g. "image-alt"
    criteria_id TEXT NOT NULL,    -- e.g. "1.1.1"
    PRIMARY KEY (axe_rule_id, criteria_id),
    FOREIGN KEY (criteria_id) REFERENCES criteria(id)
);

-- Index for reverse lookups (given a SC, find all axe rules)
CREATE INDEX IF NOT EXISTS idx_axe_mapping_criteria ON axe_mapping(criteria_id);
