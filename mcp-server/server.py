"""
WCAG MCP Server — provides WCAG 2.2 spec data to the accessibility agent.

This server exposes 4 tools:
  1. get_success_criterion — look up a WCAG SC by ID
  2. get_technique — look up a WCAG technique by ID
  3. verify_violation — check if an axe rule / finding is a real violation
  4. get_related_criteria — find SCs related to one you're investigating

The LLM calls these tools to VERIFY its Tier 2 findings before
reporting them. This prevents hallucinated violations.

Run:
  python server.py                    (stdio transport — for local MCP clients)
  python server.py --transport sse    (SSE transport — for remote clients)
"""

import sqlite3
import os
from fastmcp import FastMCP

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wcag.db")

mcp = FastMCP(
    "WCAG Spec Server",
    instructions=(
        "This server provides authoritative WCAG 2.2 specification data. "
        "Use it to verify accessibility findings against the official spec. "
        "If a finding cannot be mapped to a specific success criterion, "
        "it should not be reported as a WCAG violation."
    ),
)


def get_db() -> sqlite3.Connection:
    """Returns a SQLite connection with row factory enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ──────────────────────────────────────────────
# Tool 1: get_success_criterion
#
# The LLM calls this to understand what a WCAG SC
# actually requires. For example, it might find a
# contrast issue and call this with "1.4.3" to
# confirm what the threshold is.
# ──────────────────────────────────────────────

@mcp.tool()
def get_success_criterion(sc_id: str) -> dict:
    """Look up a WCAG 2.2 success criterion by ID.

    Args:
        sc_id: The success criterion ID, e.g. "1.4.3", "2.4.7", "4.1.2"

    Returns:
        Full criterion details: title, level, principle, intent,
        benefits, and lists of sufficient/failure techniques.
        Returns an error message if the SC is not found.
    """
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM criteria WHERE id = ?", (sc_id,)
    ).fetchone()

    if not row:
        conn.close()
        return {"error": f"Success criterion {sc_id} not found in database."}

    # Also fetch which axe-core rules test this SC
    axe_rules = conn.execute(
        "SELECT axe_rule_id FROM axe_mapping WHERE criteria_id = ?", (sc_id,)
    ).fetchall()

    conn.close()

    return {
        "id": row["id"],
        "title": row["title"],
        "level": row["level"],
        "guideline": row["guideline"],
        "principle": row["principle"],
        "intent": row["intent"],
        "benefits": row["benefits"],
        "sufficient_techniques": row["sufficient_techniques"].split(",") if row["sufficient_techniques"] else [],
        "failure_techniques": row["failure_techniques"].split(",") if row["failure_techniques"] else [],
        "axe_rules_that_test_this": [r["axe_rule_id"] for r in axe_rules],
    }


# ──────────────────────────────────────────────
# Tool 2: get_technique
#
# The LLM calls this to get implementation details
# for a specific WCAG technique — like "how do I
# actually implement G18 (contrast checking)?" or
# "what does ARIA5 say about aria-expanded?"
# ──────────────────────────────────────────────

@mcp.tool()
def get_technique(technique_id: str) -> dict:
    """Look up a WCAG technique by ID.

    Args:
        technique_id: The technique ID, e.g. "G18", "H37", "ARIA5", "F78"

    Returns:
        Technique details: title, technology, description, test procedure,
        and code examples. Returns an error message if not found.
    """
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM techniques WHERE id = ?", (technique_id,)
    ).fetchone()
    conn.close()

    if not row:
        return {"error": f"Technique {technique_id} not found in database."}

    return {
        "id": row["id"],
        "title": row["title"],
        "technology": row["technology"],
        "description": row["description"],
        "procedure": row["procedure"],
        "examples": row["examples"],
    }


# ──────────────────────────────────────────────
# Tool 3: verify_violation
#
# This is the KEY verification tool. The LLM found
# something suspicious (e.g., "this button has no
# aria-expanded") and needs to confirm it's a real
# WCAG violation before reporting it.
#
# The tool:
# 1. Maps the finding to a WCAG SC (either via
#    axe rule ID or by the SC ID the LLM provides)
# 2. Returns the SC details + relevant techniques
# 3. Lets the LLM make the final judgment with
#    authoritative spec data
#
# We do NOT make the pass/fail decision here —
# the LLM does, but with real spec data instead
# of its (possibly hallucinated) training knowledge.
# ──────────────────────────────────────────────

@mcp.tool()
def verify_violation(
    finding: str,
    axe_rule_id: str = "",
    sc_id: str = "",
    element_context: str = "",
) -> dict:
    """Verify whether a finding is a real WCAG 2.2 violation.

    Provide either an axe_rule_id (to look up which SC it maps to)
    or a sc_id (if you already know the relevant criterion).
    Include the element_context so the response can be specific.

    Args:
        finding: Description of the issue found, e.g. "Button has no aria-expanded attribute"
        axe_rule_id: Optional axe-core rule ID, e.g. "color-contrast"
        sc_id: Optional WCAG SC ID, e.g. "4.1.2"
        element_context: Optional HTML/selector of the affected element

    Returns:
        The relevant WCAG success criterion details, applicable
        techniques, and failure conditions. The LLM should use this
        data to confirm or reject the finding.
    """
    conn = get_db()

    result = {
        "finding": finding,
        "element_context": element_context,
        "mapped_criteria": [],
        "relevant_techniques": [],
        "relevant_failures": [],
    }

    # Step 1: Determine which SCs are relevant
    criteria_ids: list[str] = []

    if sc_id:
        criteria_ids.append(sc_id)

    if axe_rule_id:
        rows = conn.execute(
            "SELECT criteria_id FROM axe_mapping WHERE axe_rule_id = ?",
            (axe_rule_id,),
        ).fetchall()
        criteria_ids.extend(r["criteria_id"] for r in rows)

    # Deduplicate
    criteria_ids = list(dict.fromkeys(criteria_ids))

    if not criteria_ids:
        conn.close()
        return {
            **result,
            "verdict": "UNVERIFIABLE",
            "reason": (
                "Could not map this finding to any WCAG success criterion. "
                "Provide either a valid axe_rule_id or sc_id. "
                "If neither maps, this may be a best practice rather than "
                "a WCAG violation."
            ),
        }

    # Step 2: Fetch all mapped criteria
    for cid in criteria_ids:
        row = conn.execute(
            "SELECT * FROM criteria WHERE id = ?", (cid,)
        ).fetchone()
        if row:
            result["mapped_criteria"].append({
                "id": row["id"],
                "title": row["title"],
                "level": row["level"],
                "intent": row["intent"],
                "benefits": row["benefits"],
            })

            # Collect techniques
            for tech_id in (row["sufficient_techniques"] or "").split(","):
                tech_id = tech_id.strip()
                if tech_id:
                    tech = conn.execute(
                        "SELECT * FROM techniques WHERE id = ?", (tech_id,)
                    ).fetchone()
                    if tech:
                        result["relevant_techniques"].append({
                            "id": tech["id"],
                            "title": tech["title"],
                            "description": tech["description"],
                        })

            # Collect failure techniques
            for fail_id in (row["failure_techniques"] or "").split(","):
                fail_id = fail_id.strip()
                if fail_id:
                    fail = conn.execute(
                        "SELECT * FROM techniques WHERE id = ?", (fail_id,)
                    ).fetchone()
                    if fail:
                        result["relevant_failures"].append({
                            "id": fail["id"],
                            "title": fail["title"],
                            "description": fail["description"],
                        })

    conn.close()

    result["verdict"] = "REVIEW_WITH_SPEC"
    result["reason"] = (
        f"Found {len(result['mapped_criteria'])} relevant success criteria. "
        "Review the intent, techniques, and failure conditions above to "
        "determine if the finding constitutes a violation."
    )

    return result


# ──────────────────────────────────────────────
# Tool 4: get_related_criteria
#
# When the LLM is investigating one SC, related SCs
# can provide additional context. For example, if
# investigating 1.4.3 (contrast), 1.4.11 (non-text
# contrast) and 1.4.1 (use of color) are related.
#
# The mapping is based on shared guidelines and
# principles — SCs under the same guideline are
# considered related.
# ──────────────────────────────────────────────

@mcp.tool()
def get_related_criteria(sc_id: str) -> dict:
    """Find WCAG success criteria related to the given one.

    Related criteria are those under the same guideline.
    For example, 1.4.3 (Contrast) relates to 1.4.1 (Use of Color),
    1.4.11 (Non-text Contrast), etc.

    Args:
        sc_id: The success criterion ID, e.g. "1.4.3"

    Returns:
        List of related criteria with their IDs, titles, and levels.
    """
    conn = get_db()

    # First, find the guideline of the given SC
    row = conn.execute(
        "SELECT guideline FROM criteria WHERE id = ?", (sc_id,)
    ).fetchone()

    if not row:
        conn.close()
        return {"error": f"Success criterion {sc_id} not found."}

    guideline = row["guideline"]

    # Find all SCs under the same guideline (excluding the given one)
    related = conn.execute(
        "SELECT id, title, level, intent FROM criteria WHERE guideline = ? AND id != ? ORDER BY id",
        (guideline, sc_id),
    ).fetchall()

    conn.close()

    return {
        "source_criterion": sc_id,
        "guideline": guideline,
        "related_criteria": [
            {
                "id": r["id"],
                "title": r["title"],
                "level": r["level"],
                "intent_summary": r["intent"][:150] + "...",
            }
            for r in related
        ],
    }


if __name__ == "__main__":
    import sys

    transport = "stdio"
    if "--transport" in sys.argv:
        idx = sys.argv.index("--transport")
        if idx + 1 < len(sys.argv):
            transport = sys.argv[idx + 1]

    mcp.run(transport=transport)
