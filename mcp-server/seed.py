"""
Seed script — populates the WCAG SQLite database.

Run once: python seed.py
Creates: wcag.db in the same directory

Data sources:
  - WCAG 2.2 spec: https://www.w3.org/TR/WCAG22/
  - Understanding WCAG 2.2: https://www.w3.org/WAI/WCAG22/Understanding/
  - axe-core rule descriptions: https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "wcag.db")
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "schema.sql")


def seed():
    # Delete existing DB to start fresh
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)

    conn = sqlite3.connect(DB_PATH)

    # Create tables
    with open(SCHEMA_PATH) as f:
        conn.executescript(f.read())

    # ─── Seed criteria ────────────────────────
    criteria = [
        # Principle 1: Perceivable
        (
            "1.1.1", "Non-text Content", "A",
            "1.1 Text Alternatives", "Perceivable",
            "All non-text content (images, icons, charts) that is presented to the user has a text alternative that serves the equivalent purpose. Decorative images should be hidden from assistive technology.",
            "Blind users rely on text alternatives read by screen readers. Without alt text, images are announced as 'image' or by filename, conveying no meaning.",
            "G94,G95,H37,H36,H67,ARIA6,ARIA10", "F3,F13,F20,F30,F38,F39,F65,F71"
        ),
        (
            "1.2.1", "Audio-only and Video-only (Prerecorded)", "A",
            "1.2 Time-based Media", "Perceivable",
            "For prerecorded audio-only content, a text transcript is provided. For prerecorded video-only content, either a text alternative or an audio track is provided.",
            "Deaf users need transcripts for audio. Blind users need audio descriptions for video-only content.",
            "G158,G159,G166", "F30,F67"
        ),
        (
            "1.3.1", "Info and Relationships", "A",
            "1.3 Adaptable", "Perceivable",
            "Information, structure, and relationships conveyed through presentation (like headings, lists, tables, form labels) can be programmatically determined or are available in text.",
            "Screen reader users rely on proper HTML semantics to understand page structure. Without correct markup, a visually obvious heading looks like plain text to a screen reader.",
            "G115,G117,G140,H42,H44,H48,H49,H51,H71,H73,H85,ARIA11,ARIA12,ARIA17,ARIA20", "F2,F33,F34,F42,F43,F46,F48,F62,F68,F87,F90,F91,F92"
        ),
        (
            "1.3.2", "Meaningful Sequence", "A",
            "1.3 Adaptable", "Perceivable",
            "When the sequence in which content is presented affects its meaning, a correct reading sequence can be programmatically determined.",
            "Screen readers read content in DOM order, not visual order. If CSS reorders content visually but the DOM order doesn't match, screen reader users get a confusing sequence.",
            "G57,C6,C8", "F1,F32,F33,F34,F49"
        ),
        (
            "1.3.5", "Identify Input Purpose", "AA",
            "1.3 Adaptable", "Perceivable",
            "The purpose of each input field collecting information about the user can be programmatically determined when the input field serves a common purpose (name, email, phone, address, etc.).",
            "Users with cognitive disabilities benefit from autofill and personalized input icons. The autocomplete attribute enables browsers and assistive tech to identify field purposes.",
            "H98", ""
        ),
        (
            "1.4.1", "Use of Color", "A",
            "1.4 Distinguishable", "Perceivable",
            "Color is not used as the only visual means of conveying information, indicating an action, prompting a response, or distinguishing a visual element.",
            "Color-blind users cannot distinguish information conveyed solely by color. For example, 'fields marked in red are required' fails if there's no other indicator like an asterisk or text label.",
            "G14,G111,G182,G183,G205", "F13,F73,F81"
        ),
        (
            "1.4.2", "Audio Control", "A",
            "1.4 Distinguishable", "Perceivable",
            "If any audio on a web page plays automatically for more than 3 seconds, either a mechanism to pause/stop the audio or a mechanism to control audio volume independently from the system volume is available.",
            "Screen reader users hear the screen reader's speech overlaid with the page audio. If they can't stop the page audio, the screen reader becomes unusable.",
            "G60,G170,G171", "F23,F93"
        ),
        (
            "1.4.3", "Contrast (Minimum)", "AA",
            "1.4 Distinguishable", "Perceivable",
            "The visual presentation of text and images of text has a contrast ratio of at least 4.5:1, except for large text (18pt or 14pt bold) which requires 3:1. Incidental text (inactive components, decorative) and logotypes are exempt.",
            "Low-vision users, users in bright sunlight, and aging users need sufficient contrast to read text. ~8% of men have some form of color vision deficiency.",
            "G18,G145,G148,G174", "F24,F83"
        ),
        (
            "1.4.4", "Resize Text", "AA",
            "1.4 Distinguishable", "Perceivable",
            "Text can be resized without assistive technology up to 200 percent without loss of content or functionality.",
            "Low-vision users need to enlarge text. If the page breaks at 200% zoom, they cannot use it.",
            "G142,G146,G178,G179,C12,C13,C14,C28", "F69,F80,F94"
        ),
        (
            "1.4.5", "Images of Text", "AA",
            "1.4 Distinguishable", "Perceivable",
            "If the technologies being used can achieve the visual presentation, text is used to convey information rather than images of text, except for customizable images of text or where a particular presentation is essential (like a logo).",
            "Images of text cannot be resized, recolored, or reflowed by users who need those adjustments. Real text can be customized by the user's stylesheet or browser settings.",
            "C22,C30,G140", "F3"
        ),
        (
            "1.4.11", "Non-text Contrast", "AA",
            "1.4 Distinguishable", "Perceivable",
            "The visual presentation of UI components (controls, icons) and graphical objects (charts, infographics) has a contrast ratio of at least 3:1 against adjacent colors.",
            "Low-vision users need to see UI controls and meaningful graphics. A light gray checkbox border on white background would be invisible to many users.",
            "G195,G207,G209", "F78"
        ),
        (
            "1.4.12", "Text Spacing", "AA",
            "1.4 Distinguishable", "Perceivable",
            "No loss of content or functionality occurs when users override text spacing: line height to 1.5x font size, paragraph spacing to 2x font size, letter spacing to 0.12x font size, word spacing to 0.16x font size.",
            "Users with dyslexia and low vision often need increased text spacing to read comfortably. Pages must not break when these overrides are applied.",
            "C36,C35", "F104"
        ),
        (
            "1.4.13", "Content on Hover or Focus", "AA",
            "1.4 Distinguishable", "Perceivable",
            "Where hover or focus triggers additional content to become visible: the additional content is dismissible (Escape), hoverable (user can move pointer to it), and persistent (stays visible until dismissed or trigger is removed).",
            "Screen magnifier users need to move their viewport to read tooltips. If the tooltip disappears when they move the mouse toward it, they can never read it.",
            "C39,ARIA11", "F95"
        ),

        # Principle 2: Operable
        (
            "2.1.1", "Keyboard", "A",
            "2.1 Keyboard Accessible", "Operable",
            "All functionality of the content is operable through a keyboard interface without requiring specific timings for individual keystrokes.",
            "Users who cannot use a mouse (motor disabilities, blindness) rely entirely on keyboard navigation. If a feature only works with mouse click/hover, they are locked out.",
            "G202,H91,ARIA4", "F42,F54,F55"
        ),
        (
            "2.1.2", "No Keyboard Trap", "A",
            "2.1 Keyboard Accessible", "Operable",
            "If keyboard focus can be moved to a component using a keyboard interface, then focus can be moved away from that component using only a keyboard interface.",
            "A keyboard trap forces keyboard users to get stuck in a component (like a modal or widget) with no way to Tab or Escape out. They must abandon the page entirely.",
            "G21", "F10"
        ),
        (
            "2.2.1", "Timing Adjustable", "A",
            "2.2 Enough Time", "Operable",
            "For each time limit set by the content, the user can turn off, adjust, or extend the time limit (with exceptions for real-time events and essential time limits).",
            "Users with cognitive disabilities, blindness, or motor impairments often need more time to complete tasks. A 30-second form timeout would lock them out.",
            "G133,G180,G198,SCR16,SCR33,SCR36", "F40,F41,F58"
        ),
        (
            "2.3.1", "Three Flashes or Below Threshold", "A",
            "2.3 Seizures and Physical Reactions", "Operable",
            "Web pages do not contain anything that flashes more than three times in any one-second period, or the flash is below the general flash and red flash thresholds.",
            "Flashing content can cause seizures in people with photosensitive epilepsy. This is a safety requirement, not just usability.",
            "G15,G19,G176", ""
        ),
        (
            "2.3.3", "Animation from Interactions", "AAA",
            "2.3 Seizures and Physical Reactions", "Operable",
            "Motion animation triggered by interaction can be disabled, unless the animation is essential to the functionality or the information being conveyed.",
            "Users with vestibular disorders can experience nausea, dizziness, and migraines from motion animations. The prefers-reduced-motion media query should be respected.",
            "C39", ""
        ),
        (
            "2.4.1", "Bypass Blocks", "A",
            "2.4 Navigable", "Operable",
            "A mechanism is available to bypass blocks of content that are repeated on multiple web pages (navigation bars, headers). Common solutions: skip navigation links, ARIA landmarks, heading structure.",
            "Keyboard users must Tab through every navigation link on every page to reach the main content. A skip link lets them jump directly to content.",
            "G1,G123,G124,H69,ARIA11,SCR28", "F31"
        ),
        (
            "2.4.2", "Page Titled", "A",
            "2.4 Navigable", "Operable",
            "Web pages have titles that describe topic or purpose.",
            "Screen reader users hear the page title first when a page loads. It helps them identify which page they're on, especially when multiple tabs are open.",
            "G88,H25", "F25"
        ),
        (
            "2.4.3", "Focus Order", "A",
            "2.4 Navigable", "Operable",
            "If a web page can be navigated sequentially and the navigation sequence affects meaning or operation, focusable components receive focus in an order that preserves meaning and operability.",
            "If Tab order doesn't match visual order, keyboard users get disoriented — they press Tab and focus jumps to an unexpected part of the page.",
            "G59,H4,C27", "F44,F85"
        ),
        (
            "2.4.4", "Link Purpose (In Context)", "A",
            "2.4 Navigable", "Operable",
            "The purpose of each link can be determined from the link text alone, or from the link text together with its programmatically determined link context.",
            "Screen reader users often navigate by listing all links on a page. 'Click here' and 'Read more' tell them nothing without surrounding context.",
            "G53,G91,H24,H30,H33,ARIA7,ARIA8,SCR30", "F63,F89"
        ),
        (
            "2.4.6", "Headings and Labels", "AA",
            "2.4 Navigable", "Operable",
            "Headings and labels describe topic or purpose.",
            "Screen reader users navigate by headings to find content quickly. Vague headings like 'Section 1' don't help them find what they need.",
            "G130,G131", ""
        ),
        (
            "2.4.7", "Focus Visible", "AA",
            "2.4 Navigable", "Operable",
            "Any keyboard-operable user interface has a mode of operation where the keyboard focus indicator is visible.",
            "Keyboard users need to see where they are on the page. If focus indicators are invisible (removed via outline:none without replacement), they navigate blindly.",
            "G149,G165,G195,C15,C40,SCR31", "F55,F78"
        ),
        (
            "2.5.3", "Label in Name", "A",
            "2.5 Input Modalities", "Operable",
            "For user interface components with labels that include text or images of text, the accessible name contains the text that is presented visually.",
            "Voice control users say 'click Submit' to activate a button labeled 'Submit'. If the accessible name doesn't match the visual label, the voice command fails.",
            "G208,G211", "F96"
        ),

        # Principle 3: Understandable
        (
            "3.1.1", "Language of Page", "A",
            "3.1 Readable", "Understandable",
            "The default human language of each web page can be programmatically determined (via the lang attribute on the html element).",
            "Screen readers use the lang attribute to switch pronunciation rules. Without it, an English screen reader might try to pronounce French text with English phonetics.",
            "H57", "F32"
        ),
        (
            "3.1.2", "Language of Parts", "AA",
            "3.1 Readable", "Understandable",
            "The human language of each passage or phrase in the content can be programmatically determined, except for proper names, technical terms, and words of indeterminate language.",
            "When a page contains text in multiple languages, screen readers need lang attributes on those sections to switch pronunciation.",
            "H58", ""
        ),
        (
            "3.2.1", "On Focus", "A",
            "3.2 Predictable", "Understandable",
            "When any user interface component receives focus, it does not initiate a change of context (page navigation, form submission, significant content change).",
            "If tabbing to a dropdown immediately submits a form or navigates away, keyboard users lose their place and context unexpectedly.",
            "G107", "F52,F55"
        ),
        (
            "3.2.2", "On Input", "A",
            "3.2 Predictable", "Understandable",
            "Changing the setting of any user interface component does not automatically cause a change of context unless the user has been advised of the behavior before using the component.",
            "Selecting an option in a dropdown shouldn't immediately navigate to a new page without warning. Users need predictable behavior.",
            "G80,G13,H32,H84,SCR19", "F36,F37"
        ),
        (
            "3.3.1", "Error Identification", "A",
            "3.3 Input Assistance", "Understandable",
            "If an input error is automatically detected, the item that is in error is identified and the error is described to the user in text.",
            "Screen reader users cannot see red borders or color changes indicating errors. Errors must be announced as text that the screen reader can read.",
            "G83,G84,G85,ARIA18,ARIA19,ARIA21,SCR18,SCR32", ""
        ),
        (
            "3.3.2", "Labels or Instructions", "A",
            "3.3 Input Assistance", "Understandable",
            "Labels or instructions are provided when content requires user input.",
            "Users with cognitive disabilities need clear instructions. All users benefit from knowing what format is expected (e.g., 'Date: MM/DD/YYYY').",
            "G13,G89,G131,G162,G184,H44,H65,H71,ARIA1,ARIA17", "F82"
        ),

        # Principle 4: Robust
        (
            "4.1.1", "Parsing", "A",
            "4.1 Compatible", "Robust",
            "In content implemented using markup languages, elements have complete start and end tags, are nested according to spec, don't contain duplicate attributes, and IDs are unique. Note: This criterion was removed in WCAG 2.2 as browsers now handle parsing errors consistently.",
            "Deprecated in WCAG 2.2. Browsers now handle malformed HTML gracefully, so parsing issues rarely cause accessibility problems.",
            "", ""
        ),
        (
            "4.1.2", "Name, Role, Value", "A",
            "4.1 Compatible", "Robust",
            "For all user interface components (including form elements, links, and components generated by scripts), the name and role can be programmatically determined; states, properties, and values that can be set by the user can be programmatically set; and notification of changes to these items is available to user agents, including assistive technologies.",
            "Screen readers need to announce what a component is (role: button), what it's called (name: Submit), and what state it's in (expanded: true). Custom widgets built with <div> and JavaScript must explicitly provide this information via ARIA.",
            "G10,G108,G135,G196,H44,H64,H65,H88,H91,ARIA4,ARIA5,ARIA14,ARIA16", "F15,F20,F59,F68,F79,F86"
        ),
        (
            "4.1.3", "Status Messages", "AA",
            "4.1 Compatible", "Robust",
            "In content implemented using markup languages, status messages can be programmatically determined through role or properties such that they can be presented to the user by assistive technologies without receiving focus. Use role='status', role='alert', or aria-live regions.",
            "When a form shows 'Saved successfully' or a search shows '5 results found', sighted users see it immediately. Screen reader users miss it unless it's in a live region that gets announced automatically.",
            "ARIA22,ARIA19,G199,G83,G84,G85,G177,G193,G194", "F103"
        ),
    ]

    conn.executemany(
        "INSERT INTO criteria VALUES (?,?,?,?,?,?,?,?,?)",
        criteria,
    )

    # ─── Seed techniques ──────────────────────
    techniques = [
        # General techniques
        ("G1", "Adding a link at the top of each page that goes directly to the main content area", "general",
         "Provide a skip navigation link as the first focusable element on the page. The link should jump to the beginning of the main content, bypassing repeated navigation.",
         "1. Check that a link is the first focusable element on the page. 2. Check that the link text communicates that it links to the main content. 3. Check that activating the link moves focus to the main content.",
         '<a href="#main" class="skip-link">Skip to main content</a>'),

        ("G18", "Ensuring that a contrast ratio of at least 4.5:1 exists between text and background", "general",
         "Measure the contrast ratio between foreground text color and background color. The ratio must be at least 4.5:1 for normal text and 3:1 for large text (18pt or 14pt bold).",
         "1. Measure the relative luminance of the foreground text color. 2. Measure the relative luminance of the background color. 3. Calculate contrast ratio: (L1 + 0.05) / (L2 + 0.05) where L1 is the lighter luminance. 4. Verify ratio meets 4.5:1 (normal text) or 3:1 (large text).",
         "Normal text minimum: 4.5:1. Large text minimum: 3:1. Large text = 18pt (24px) or 14pt (18.66px) bold."),

        ("G14", "Ensuring that information conveyed by color differences is also available in text", "general",
         "When color is used to convey information, provide a text alternative or additional visual indicator (icon, pattern, underline).",
         "1. Identify all instances where color is used to convey information. 2. Verify that the same information is available through text or other visual means.",
         "Required fields: use * or 'required' text, not just red color. Error states: use text messages, not just red borders."),

        ("G21", "Ensuring that users are not trapped in content", "general",
         "Ensure that keyboard focus can always be moved away from any component using standard keyboard controls (Tab, Shift+Tab, Escape, arrow keys).",
         "1. Tab to every interactive element. 2. Verify you can Tab away from each one. 3. For modal dialogs, verify Escape closes the dialog and returns focus.",
         "Common traps: embedded iframes, modal dialogs without Escape handler, custom widgets that capture Tab."),

        # HTML techniques
        ("H37", "Using alt attributes on img elements", "html",
         "Provide a text alternative for images using the alt attribute. For decorative images, use alt='' (empty string) to hide them from screen readers.",
         "1. Check that every img element has an alt attribute. 2. For informative images, verify alt text conveys the same information. 3. For decorative images, verify alt=''.",
         '<img src="chart.png" alt="Sales increased 40% in Q3 2024"> or <img src="decorative-border.png" alt="">'),

        ("H42", "Using h1-h6 to identify headings", "html",
         "Use HTML heading elements (h1-h6) to mark up headings. Headings should follow a logical hierarchy without skipping levels.",
         "1. Check that heading markup is used for all content that functions as a heading. 2. Check that heading levels are logically nested (h1 > h2 > h3, not h1 > h3).",
         "<h1>Page Title</h1><h2>Section</h2><h3>Subsection</h3>"),

        ("H44", "Using label elements to associate text labels with form controls", "html",
         "Use the label element with a for attribute matching the form control's id to create a programmatic association between labels and inputs.",
         "1. Check that every form control has a label element. 2. Check that the label's for attribute matches the control's id. 3. Verify the label text describes the input's purpose.",
         '<label for="email">Email address</label><input type="email" id="email">'),

        ("H57", "Using the language attribute on the HTML element", "html",
         "Specify the primary language of the page using the lang attribute on the html element.",
         "1. Check that the html element has a lang attribute. 2. Check that the value is a valid BCP 47 language tag.",
         '<html lang="en">'),

        ("H25", "Providing a title using the title element", "html",
         "Provide a descriptive page title using the HTML title element within the head section.",
         "1. Check that the head section contains a title element. 2. Check that the title describes the page's topic or purpose.",
         "<title>Shopping Cart - MyStore</title>"),

        # ARIA techniques
        ("ARIA4", "Using a WAI-ARIA role to expose the role of a user interface component", "aria",
         "Use ARIA roles to identify the purpose of custom widgets. Native HTML elements already have implicit roles — only use ARIA when building custom components with non-semantic elements.",
         "1. Check that the element has a role attribute. 2. Check that the role value is appropriate for the component. 3. Check that the element's behavior matches the expected behavior for that role.",
         '<div role="button" tabindex="0" onclick="...">Submit</div> — but prefer <button>Submit</button>'),

        ("ARIA5", "Using WAI-ARIA state and property attributes to expose the state of a user interface component", "aria",
         "Use ARIA states (aria-expanded, aria-selected, aria-checked, aria-pressed) to communicate the current state of interactive components to assistive technology.",
         "1. Check that state attributes are present on components that change state. 2. Check that state values update when the component state changes. 3. Check that the state matches the visual presentation.",
         '<button aria-expanded="false" aria-controls="menu">Menu</button><ul id="menu" hidden>...</ul>'),

        ("ARIA11", "Using ARIA landmarks to identify regions of a page", "aria",
         "Use ARIA landmark roles (or HTML5 semantic elements which have implicit landmark roles) to identify the major regions of a page. Add aria-label or aria-labelledby to distinguish multiple landmarks of the same type.",
         "1. Check that major page regions use landmark roles. 2. Check that multiple landmarks of the same role have distinct accessible names.",
         '<nav aria-label="Main navigation">...</nav><nav aria-label="Footer links">...</nav>'),

        ("ARIA16", "Using aria-labelledby to provide a name for user interface controls", "aria",
         "Use aria-labelledby to associate a visible text element as the accessible name for a control. The referenced element's text becomes the control's name.",
         "1. Check that aria-labelledby references a valid element ID. 2. Check that the referenced element contains descriptive text. 3. Check that the accessible name matches the visual label.",
         '<h2 id="billing">Billing Address</h2><section aria-labelledby="billing">...</section>'),

        ("ARIA22", "Using role=status to present status messages", "aria",
         "Use role='status' on an element to create a live region that announces status updates (search results count, form save confirmation) without moving focus.",
         "1. Check that status messages are inserted into an element with role='status'. 2. Check that the element is present in the DOM before the status message is added. 3. Verify the message is announced by screen readers without focus change.",
         '<div role="status">5 results found</div> or <div role="status">Form saved successfully</div>'),

        # Failure techniques
        ("F3", "Using CSS to include images that convey important information", "failure",
         "FAILURE: Using CSS background-image for images that convey information without providing a text alternative. CSS background images are invisible to screen readers.",
         "1. Check for CSS background-image properties. 2. Determine if the image conveys information. 3. If yes, check if a text alternative is provided elsewhere.",
         "Fail: div { background-image: url(warning-icon.png); } with no text alternative for the warning."),

        ("F65", "Failure of SC 1.1.1 due to omitting the alt attribute on img elements", "failure",
         "FAILURE: An img element without an alt attribute. Screen readers may read the filename instead, which is usually meaningless.",
         "1. Check all img elements for the presence of an alt attribute.",
         'Fail: <img src="IMG_20240301.jpg"> — screen reader says "IMG underscore 20240301 dot jpg"'),

        ("F78", "Failure of SC 2.4.7 due to styling element outlines and borders in a way that removes or renders non-visible the visual focus indicator", "failure",
         "FAILURE: Using CSS to remove focus indicators (outline: none, outline: 0) without providing an alternative visible focus style.",
         "1. Set focus to each focusable element using Tab. 2. Check that a visible focus indicator is present. 3. Check that outline:none is not used without a replacement style.",
         'Fail: *:focus { outline: none; } — removes all focus indicators. Fix: *:focus-visible { outline: 2px solid #005fcc; }'),

        ("F83", "Failure of SC 1.4.3 due to using background images that do not provide sufficient contrast", "failure",
         "FAILURE: Text placed over a background image where parts of the image do not provide sufficient contrast with the text.",
         "1. Check text over background images. 2. Measure contrast at multiple points where text overlaps the image. 3. Verify minimum 4.5:1 for normal text.",
         "Fail: White text over a photograph with light areas. Fix: Add a semi-transparent overlay behind the text."),

        ("F96", "Failure of SC 2.5.3 due to accessible name not containing the visible label text", "failure",
         "FAILURE: The accessible name of a control does not contain the text that is visually displayed. Voice control users say 'click [visible label]' but it doesn't match.",
         "1. Check that the accessible name contains the visible label text. 2. Check that the visible text appears at the start of the accessible name if possible.",
         'Fail: <button aria-label="close dialog">X</button> when user sees "X" but voice command "click X" may not work if aria-label doesn\'t match.'),
    ]

    conn.executemany(
        "INSERT INTO techniques VALUES (?,?,?,?,?,?)",
        techniques,
    )

    # ─── Seed axe-core rule → WCAG SC mapping ─
    # Source: axe-core's tag system maps rules to WCAG SCs
    # e.g., "image-alt" is tagged wcag111 → SC 1.1.1
    axe_mappings = [
        # Images
        ("image-alt", "1.1.1"),
        ("input-image-alt", "1.1.1"),
        ("object-alt", "1.1.1"),
        ("svg-img-alt", "1.1.1"),
        ("area-alt", "1.1.1"),
        ("role-img-alt", "1.1.1"),

        # Color contrast
        ("color-contrast", "1.4.3"),
        ("color-contrast-enhanced", "1.4.3"),
        ("link-in-text-block", "1.4.1"),

        # Structure
        ("heading-order", "1.3.1"),
        ("empty-heading", "1.3.1"),
        ("p-as-heading", "1.3.1"),
        ("definition-list", "1.3.1"),
        ("dlitem", "1.3.1"),
        ("list", "1.3.1"),
        ("listitem", "1.3.1"),
        ("table-fake-caption", "1.3.1"),
        ("td-headers-attr", "1.3.1"),
        ("th-has-data-cells", "1.3.1"),
        ("scope-attr-valid", "1.3.1"),

        # Forms
        ("label", "1.3.1"),
        ("label", "4.1.2"),
        ("input-button-name", "4.1.2"),
        ("select-name", "4.1.2"),
        ("autocomplete-valid", "1.3.5"),

        # ARIA
        ("aria-allowed-attr", "4.1.2"),
        ("aria-required-attr", "4.1.2"),
        ("aria-valid-attr", "4.1.2"),
        ("aria-valid-attr-value", "4.1.2"),
        ("aria-roles", "4.1.2"),
        ("aria-hidden-body", "4.1.2"),
        ("aria-hidden-focus", "4.1.2"),
        ("aria-input-field-name", "4.1.2"),
        ("aria-toggle-field-name", "4.1.2"),
        ("aria-command-name", "4.1.2"),
        ("aria-meter-name", "1.1.1"),
        ("aria-progressbar-name", "1.1.1"),

        # Keyboard
        ("tabindex", "2.4.3"),
        ("bypass", "2.4.1"),
        ("focus-order-semantics", "2.4.3"),

        # Focus
        ("focus-trap", "2.1.2"),

        # Navigation
        ("document-title", "2.4.2"),
        ("page-has-heading-one", "2.4.6"),
        ("frame-title", "2.4.2"),

        # Language
        ("html-has-lang", "3.1.1"),
        ("html-lang-valid", "3.1.1"),
        ("html-xml-lang-mismatch", "3.1.1"),
        ("valid-lang", "3.1.2"),

        # Links
        ("link-name", "4.1.2"),
        ("link-name", "2.4.4"),
        ("identical-links-same-purpose", "2.4.4"),

        # Landmark
        ("landmark-banner-is-top-level", "1.3.1"),
        ("landmark-contentinfo-is-top-level", "1.3.1"),
        ("landmark-main-is-top-level", "1.3.1"),
        ("landmark-no-duplicate-banner", "1.3.1"),
        ("landmark-no-duplicate-contentinfo", "1.3.1"),
        ("landmark-one-main", "1.3.1"),
        ("region", "1.3.1"),

        # Timing & motion
        ("meta-refresh", "2.2.1"),
        ("blink", "2.3.1"),
        ("marquee", "2.3.1"),

        # Video/audio
        ("video-caption", "1.2.1"),
        ("audio-caption", "1.2.1"),

        # Button name
        ("button-name", "4.1.2"),
    ]

    conn.executemany(
        "INSERT OR IGNORE INTO axe_mapping VALUES (?,?)",
        axe_mappings,
    )

    conn.commit()
    conn.close()

    # Print summary
    print(f"Database created: {DB_PATH}")
    print(f"  {len(criteria)} success criteria")
    print(f"  {len(techniques)} techniques")
    print(f"  {len(axe_mappings)} axe-core rule mappings")


if __name__ == "__main__":
    seed()
