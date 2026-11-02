# Issue tracker: GitHub

Issues and specs for this repo live in GitHub Issues at https://github.com/visual-check/visual-check/issues. Use the `gh` CLI for all operations.

## Conventions

- One feature per spec issue; the spec is the issue body
- Implementation tickets are one issue each, linked to the spec as sub-issues, never a single combined tickets issue
- Triage state is recorded as a label (see `triage-labels.md` for the role strings)
- Comments and conversation history live in the issue's comments

## When a skill says "publish to the issue tracker"

Create a new issue: `gh issue create --title "<title>" --body "<body>"`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`. The user will normally pass the issue number or URL directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is an issue with one **child** issue per ticket.

- **Map**: an issue labelled `wayfinder:map` whose body holds the Destination / Notes / Decisions so far / Not yet specified / Out of scope sections.
- **Child ticket**: a sub-issue of the map (`POST repos/{owner}/{repo}/issues/{map}/sub_issues` with the child's database id as `sub_issue_id`), with the question in the body. A `wayfinder:<type>` label records the ticket type (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: GitHub's native issue dependencies (`POST repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by` with the blocker's database id as `issue_id`). A ticket is unblocked when every issue blocking it is closed.
- **Frontier**: scan the map's open sub-issues for ones that are unblocked (`issue_dependencies_summary.blocked_by` is 0) and unassigned; lowest number wins.
- **Claim**: `gh issue edit <number> --add-assignee @me` before any work.
- **Resolve**: add the answer as a comment under an `## Answer` heading, close the issue, then append a context pointer (gist + link) to Decisions-so-far in the map's body.
