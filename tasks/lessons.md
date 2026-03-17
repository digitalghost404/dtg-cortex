# Lessons Learned

## Testing
- `vi.restoreAllMocks()` breaks module-level mocks created with `vi.mock()` — use `vi.clearAllMocks()` instead
- When testing mood computation priority chains (DORMANT > FOCUSED > RESTLESS > ABSORBING > CONTEMPLATIVE), earlier conditions can shadow later ones — craft test data that bypasses higher-priority checks
- v8 coverage counts ternary branches and `??` fallbacks as separate branches — use `/* v8 ignore next */` for structurally unreachable defensive code
- Module-level constants (`const X = process.env.Y`) are captured at import time — use `vi.hoisted()` or dynamic imports to test different env configurations

## Security
- NEVER put real API keys in example/template files — always use placeholders like `sk-ant-your-key-here`
- GitHub push protection will block pushes containing secrets even in `.example` files
- If a key is accidentally committed, rotate it immediately even if the push was rejected
