# Issue tracker: GitHub

Issues and PRDs for this repository live in GitHub Issues at `grumm1728/writespacer`. Use the `gh` CLI for issue operations.

## Conventions

- Create, read, comment on, label, and close work using `gh issue`.
- Infer the repository from the configured Git remote.
- Pull requests are not a triage request surface.
- When a skill says “publish to the issue tracker,” create a GitHub issue.
- When a skill says “fetch the relevant ticket,” read the complete GitHub issue and its comments.
- Prefer GitHub’s native issue dependencies for blocking edges.
- If native dependencies are unavailable, include `Blocked by: #<number>` in the issue body.
- A ticket is ready when all blockers are closed and it has no assignee.
