"""Quick test — calls each MCP tool directly (without MCP transport)."""

from server import (
    get_success_criterion,
    get_technique,
    verify_violation,
    get_related_criteria,
)
import json


def pp(label: str, data):
    print(f"\n{'=' * 60}")
    print(f"  {label}")
    print('=' * 60)
    print(json.dumps(data, indent=2))


# ─── Test 1: Look up a success criterion ───
pp(
    "TEST 1: get_success_criterion('1.4.3') — Contrast",
    get_success_criterion("1.4.3"),
)

# ─── Test 2: Look up a technique ───
pp(
    "TEST 2: get_technique('ARIA5') — ARIA states",
    get_technique("ARIA5"),
)

# ─── Test 3: Verify an axe-core finding ───
pp(
    "TEST 3: verify_violation — axe-core color-contrast rule",
    verify_violation(
        finding="Footer text has contrast ratio of 3.76:1, below 4.5:1 threshold",
        axe_rule_id="color-contrast",
        element_context='<span>© 2026</span> with color #6b6a6c on bg #050510',
    ),
)

# ─── Test 4: Verify an LLM-found issue (by SC ID) ───
pp(
    "TEST 4: verify_violation — LLM found missing aria-expanded",
    verify_violation(
        finding="Toggle button has no aria-expanded attribute",
        sc_id="4.1.2",
        element_context='<button>▶expand details</button> with click handler, no ARIA states',
    ),
)

# ─── Test 5: Verify something that doesn't map ───
pp(
    "TEST 5: verify_violation — unmappable finding",
    verify_violation(
        finding="Page uses Comic Sans font",
    ),
)

# ─── Test 6: Get related criteria ───
pp(
    "TEST 6: get_related_criteria('1.4.3') — what relates to contrast?",
    get_related_criteria("1.4.3"),
)

# ─── Test 7: Look up focus visibility failure ───
pp(
    "TEST 7: get_technique('F78') — focus indicator removal",
    get_technique("F78"),
)

# ─── Test 8: Verify skip link finding ───
pp(
    "TEST 8: verify_violation — no skip navigation link",
    verify_violation(
        finding="No skip navigation link present. Keyboard users must tab through 5 nav links to reach content.",
        sc_id="2.4.1",
        element_context="First focusable element is a nav link, not a skip link",
    ),
)
