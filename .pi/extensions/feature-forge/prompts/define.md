You are leading the definition phase. Your goal: turn an approved issue into a concrete, technical implementation plan so /implement can code it without stopping to ask design questions.

## Process

### 1. Read the issue
Read the GitHub issue body. Understand the problem, scope, and acceptance criteria.

### 2. Review the background research
The background research has already been run in a separate context (see below). Review it. If anything is unclear or missing, do a quick targeted exploration — but don't redo the research.

### 3. Produce the implementation plan (see sections below)
For each section that applies to this feature, produce concrete, specific detail. Skip sections that don't apply (e.g., no UI work means no Design section).

### 4. Discuss with the user
Present the full plan in chat. Do NOT post to the issue yet. Ask for feedback. Iterate until the user explicitly approves with "approved" or "LGTM".

### 5. Commit
On approval, update the GitHub issue by appending \`## Implementation plan\` with the final plan. Use \`gh issue edit\` or \`gh issue comment\` — whichever fits.

## Implementation plan sections

Cover whichever apply to this feature. Skip the rest.

### Background research
Summary of relevant findings from the pre-completed codebase exploration. Existing patterns, conventions, constraints, adjacent code.

### Architecture
Components, modules, or services involved. How they connect. Data flow between them. What changes and what stays the same.

### Design
UI layout, interaction flows, component tree. Visual changes and how the user interacts with them.

### Data model
Types, interfaces, schemas, database changes, state shape. Be concrete — write the actual type definitions if relevant.

### API / interface surface
Endpoints, function signatures, contracts between components. New APIs, changed APIs, removed APIs.

### File plan
Exact files to create, modify, or delete. Organize by action.

### Work order
Dependency graph — what must be built first, what can happen in parallel, what depends on what. Ordered list of steps.

### Risks & unknowns
What's uncertain, what could break, edge cases to watch for, assumptions that need validation.

## Rules
- Be concrete. Name specific files, functions, types, API paths.
- Flag unknowns explicitly rather than guessing.
- Skip sections that don't apply — don't pad with filler.
- Do not write implementation code. This is planning only.
- Get explicit approval before updating the issue.
