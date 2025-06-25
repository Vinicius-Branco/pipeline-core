# Mutation Testing

This document explains how to use mutation testing in the pipeline-core project, which now supports both unit and integration tests.

## Available Configurations

### 1. Mutation Testing - Unit Tests Only
```bash
npm run test:mutation:unit
```
- **Configuration**: `stryker.unit.conf.mjs`
- **Tests**: Unit tests only (`src/services/__tests__/unit/*.test.ts`)
- **Performance**: Faster, focused on business logic
- **Thresholds**: 80% (high), 70% (low), 60% (break)

### 2. Mutation Testing - Integration Tests Only
```bash
npm run test:mutation:integration
```
- **Configuration**: `stryker.integration.conf.mjs`
- **Tests**: Integration tests only (`src/services/__tests__/integration/*.test.ts`)
- **Performance**: Slower, focused on system behavior
- **Thresholds**: 70% (high), 60% (low), 50% (break)

### 3. Mutation Testing - All Tests
```bash
npm run test:mutation:all
```
- **Configuration**: `stryker.conf.mjs`
- **Tests**: Both unit and integration tests
- **Performance**: Slower, complete coverage
- **Thresholds**: 80% (high), 70% (low), 60% (break)

### 4. Mutation Testing - Default
```bash
npm run test:mutation
```
- **Configuration**: `stryker.conf.mjs` (default)
- **Tests**: All tests
- **Performance**: Complete

## Configuration Differences

### Unit Tests (`stryker.unit.conf.mjs`)
- **Timeout**: 30 seconds
- **Concurrency**: 4 workers
- **Focus**: Isolated business logic
- **Thresholds**: More strict

### Integration Tests (`stryker.integration.conf.mjs`)
- **Timeout**: 60 seconds
- **Concurrency**: 2 workers
- **Focus**: System behavior
- **Thresholds**: More flexible

## When to Use Each Configuration

### Use Unit Tests When:
- Rapid feature development
- Debugging specific logic
- CI/CD with limited time
- Focus on isolated code quality

### Use Integration Tests When:
- Complete workflow validation
- Testing component interactions
- Ensuring system behavior
- Release candidates

### Use All Tests When:
- Complete validation before releases
- Comprehensive quality analysis
- Identifying coverage gaps
- Quality audit

## Usage Examples

### Daily Development
```bash
# During development, use unit tests only
npm run test:mutation:unit
```

### Before a Release
```bash
# Complete validation before release
npm run test:mutation:all
```

### Integration Debugging
```bash
# Focus on integration issues
npm run test:mutation:integration
```

### Quick Preview
```bash
# Quick execution for verification
npm run test:mutation:preview
```

## Interpreting Results

### Mutation Score
- **80-100%**: Excellent test quality
- **70-79%**: Good quality, some improvements needed
- **60-69%**: Acceptable quality, improvements recommended
- **<60%**: Low quality, improvements necessary

### Mutant Types
- **Killed**: Mutant was detected by tests ✅
- **Survived**: Mutant was not detected by tests ❌
- **Timeout**: Mutant caused timeout ⏰
- **Runtime Error**: Mutant caused runtime error 💥

## Improvement Strategies

### For Surviving Mutants:
1. **Add specific test cases**
2. **Improve existing assertions**
3. **Test edge cases**
4. **Add integration tests**

### For Timeouts:
1. **Increase timeouts if necessary**
2. **Optimize slow tests**
3. **Use mocks for heavy operations**

### For Runtime Errors:
1. **Add input validation**
2. **Test error scenarios**
3. **Improve exception handling**

## CI/CD Configuration

### GitHub Actions Example
```yaml
- name: Mutation Testing - Unit
  run: npm run test:mutation:unit
  if: github.event_name == 'pull_request'

- name: Mutation Testing - All
  run: npm run test:mutation:all
  if: github.ref == 'refs/heads/main'
```

### GitLab CI Example
```yaml
mutation_testing:
  stage: test
  script:
    - npm run test:mutation:unit
  only:
    - merge_requests
```

## Troubleshooting

### Common Issues

1. **Excessive Timeout**
   ```bash
   # Increase timeout in configuration
   timeoutMS: 60000
   ```

2. **Insufficient Memory**
   ```bash
   # Increase Node memory
   testRunnerNodeArgs: ["--max_old_space_size=8192"]
   ```

3. **Too High Concurrency**
   ```bash
   # Reduce concurrency
   concurrency: 2
   ```

### Logs and Debugging
```bash
# Detailed logs
npm run test:mutation:unit -- --logLevel debug

# Text report only
npm run test:mutation:unit -- --reporters clear-text
```

## IDE Integration

### VS Code
- Install the "Stryker Mutator" extension
- Configure the workspace to use the correct configurations
- Use the "Stryker: Run" command to execute mutation tests

### IntelliJ/WebStorm
- Configure Stryker as an external tool
- Use npm scripts for execution
- Configure HTML report for visualization

## Next Steps

1. **Automate** mutation testing in CI/CD
2. **Configure appropriate thresholds** for your project
3. **Monitor** test quality over time
4. **Train** the team on interpreting results
5. **Integrate** with code quality tools 