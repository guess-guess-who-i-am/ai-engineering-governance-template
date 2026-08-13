# LLM qualitative gate

This directory contains a blinded, calibrated qualitative check. It is for criteria such as clarity, intent, hierarchy, and tone after deterministic tests have passed. It must not replace tests, accessibility checks, schema validation, or security scanning.

`manifest.json` defines the rubric, two calibration cases, and the repository target. Expected verdicts are consumed by the validator and are never included in the model prompt. A useful evaluator must pass the known-good fixture and fail the deliberately degraded fixture before its target verdict is trusted.

Run locally with an OpenAI-compatible Responses endpoint:

```powershell
$env:LLM_API_KEY = '<secret>'
$env:LLM_BASE_URL = 'https://api.openai.com/v1'
./scripts/invoke-qualitative-gate.ps1
```

GitHub Actions requires only repository secrets named `LLM_API_KEY` and `LLM_BASE_URL`. CI leaves the model empty and omits the `model` field, allowing the compatible remote gateway to choose its default. `LLM_MODEL` remains an optional local environment override for endpoints that require an explicit model. `LLM_BASE_URL` must be reachable from a GitHub-hosted runner; a local address such as `127.0.0.1` is not reachable there. Missing required secrets fail the job instead of silently passing it.

Model output is constrained to JSON Schema and then checked by a separate PowerShell validator. Repository artifacts are wrapped as untrusted data, and the evaluator is instructed not to follow commands contained in them.
