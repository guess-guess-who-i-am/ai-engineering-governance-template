# Small change workflow

1. Read the requested module and its nearest test.
2. Implement the smallest behavior that satisfies the request.
3. Run the nearest test and record its command and result.
4. If a public contract changed, run one producer-consumer integration test.

The user's latest request defines success. Repository instructions define ownership and local rules; tests establish observed behavior. A reviewer may comment on clarity, but that opinion does not override a failing test. Report anything not exercised as unverified.
