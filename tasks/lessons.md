# Lessons Learned

## Testing
- `vi.restoreAllMocks()` breaks module-level mocks created with `vi.mock()` — use `vi.clearAllMocks()` instead
- When testing mood computation priority chains (DORMANT > FOCUSED > RESTLESS > ABSORBING > CONTEMPLATIVE), earlier conditions can shadow later ones — craft test data that bypasses higher-priority checks
- v8 coverage counts ternary branches and `??` fallbacks as separate branches — use `/* v8 ignore next */` for structurally unreachable defensive code
- Module-level constants (`const X = process.env.Y`) are captured at import time — use `vi.hoisted()` or dynamic imports to test different env configurations
