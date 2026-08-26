---
name: model-project-domain
description: Build or revise a project's domain context from real business language, consumers, contracts, state transitions, invariants, ownership, and ambiguity decisions. Use when starting a domain-heavy project or when terminology and boundaries conflict. Do not use for local implementation details that have one clear owner.
---

# Model Project Domain

## Goal

Produce the smallest shared model that changes implementation decisions. Prefer evidence from users, existing interfaces, data, and workflows over invented taxonomies.

## Workflow

1. Collect concrete scenarios: actor, intent, input, state change, output, and failure.
2. Extract terms used by real consumers. For each term record one definition, aliases that should not become parallel concepts, and the owning boundary.
3. Identify entities, value objects, events, commands, policies, and external systems only when they explain observed behavior.
4. Write invariants as falsifiable statements. Example: “a released version has exactly one immutable source commit,” not “releases should be reliable.”
5. Map public contracts and state transitions to their producer and consumers. Resolve conflicts at the authority closest to behavior.
6. Test the model against at least one success, one failure, and one boundary scenario. Remove concepts that do not affect any decision.
7. Update the project's domain context or owning contract, then identify implementation and test consumers that must change.

## Guardrails

Do not treat folder names as domain truth. Do not add compatibility aliases to conceal conflicting definitions. Mark uncertain claims and ask only when the choice materially changes behavior. Keep task procedures in Skills and deterministic schemas outside the domain context.

## Output

Return definitions, ownership, relationships, invariants, unresolved decisions, and the concrete consumers affected. Diagrams are optional and should only be used when they clarify three or more relationships.

## User requirement — original wording translated into English

> “I want to establish a new project, but I do not know how to do it. Please examine what approach would be better.”
