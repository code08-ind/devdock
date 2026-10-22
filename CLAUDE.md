# DevDock — agent notes

1. **Read `docs/PROGRESS.md` first.** It says which phase/step to pick up from. Update it
   (tick steps with evidence, set "Current position", append to the Session log) before you
   finish any session.
2. The contract is `docs/SPEC.md` + `docs/UI-THEMES.md`; phase tasks/Done criteria are in
   `docs/BUILD-PROMPTS.md`. Record every new dependency or deviation in `docs/DECISIONS.md`.
3. Checks: `npm run lint`, `npm test`, `npm run e2e`, `npm run dist`. Never claim a check you
   did not run.
4. Project skills in `.claude/skills/` (pinned in `skills-lock.json`), approved by the user:
   - `frontend-design` + `vercel-react-best-practices` for renderer work. `docs/UI-THEMES.md`
     wins over any aesthetic advice, and the Next.js/server rules don't apply.
   - `nodejs-backend-patterns` for main-process services; ignore its Express/DB specifics.
   - `code-review` (Standards + Spec vs `docs/SPEC.md`) at each sub-phase/phase boundary.
