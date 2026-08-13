# Governance Template Smoke Flow

This flow demonstrates documentation as executable evidence. It checks the public GitHub API because this repository does not yet ship an application server.

```step
@id repository
@name Read a public repository

GET /repos/VoltAgent/awesome-design-md
Accept: application/vnd.github+json
User-Agent: engineering-governance-template

[Captures]
repository_name = name
default_branch = default_branch

[Asserts]
status == 200
body.name == "awesome-design-md"
body.default_branch exists
```

```step
@id design_file
@name Verify the pinned design artifact exists

GET /repos/VoltAgent/awesome-design-md/contents/design-md/elevenlabs/DESIGN.md?ref={{default_branch}}
Accept: application/vnd.github+json
User-Agent: engineering-governance-template

[Asserts]
status == 200
body.name == "DESIGN.md"
body.path == "design-md/elevenlabs/DESIGN.md"
```

```edge
@from repository
@to design_file
@on success
```
