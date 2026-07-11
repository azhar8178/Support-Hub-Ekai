---
name: Validation commands are workflows
description: setValidationCommand fails if a plain workflow with the same name already exists; register validation first
---

# Validation commands are workflows under the hood

**Rule:** Register CI-style checks with `setValidationCommand` directly — do NOT `configureWorkflow` a plain workflow with the same name first. A name registered as a non-validation workflow cannot be switched to a validation workflow ("already exists as a non-validation workflow"); you must `removeWorkflow` it first, then `setValidationCommand`.

**Why:** Validation commands are backed by workflows of the same name (that's why `api-typecheck`/`api-tests` appear in the configured-workflows list). `startValidationRun` errors with `NO_MATCHING_WORKFLOW` for names that only exist as plain workflows.

**How to apply:** For typecheck/test/lint gates (`portal-typecheck`, `mockup-typecheck`, `api-typecheck`, `api-tests`), use the validation skill callbacks only; they show up as workflows automatically.
