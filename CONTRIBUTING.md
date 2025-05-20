# Contributing Guide

Thank you for your interest in contributing to Pipeline Core! This document provides guidelines and instructions for contributing to the project.

## How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/new-feature`)
3. Commit your changes (`git commit -m 'Add new feature'`)
4. Push to the branch (`git push origin feature/new-feature`)
5. Open a Pull Request

## Code Standards

- Follow existing code patterns in the project
- Use TypeScript for all new code
- Maintain high test coverage
- Run `npm run lint` and `npm run test` before submitting your PR

## Project Structure

```
pipeline-core/
├── src/              # Source code
├── tests/            # Tests
├── types/            # TypeScript type definitions
└── docs/             # Documentation
```

## Development

1. Install dependencies:

```bash
npm install
```

2. Run tests:

```bash
npm test
```

3. Run linter:

```bash
npm run lint
```

## Pull Requests

- Keep PRs small and focused
- Include tests for new features
- Update documentation when necessary
- Clearly describe changes in the PR

## Issues

- Use the appropriate issue template
- Provide sufficient details to reproduce the problem
- Include relevant environment versions

## Communication

- Keep communication professional and respectful
- Use English for issues and PRs
- Respond to comments and feedback constructively

## License

By contributing, you agree that your contributions will be licensed under the same MIT license as the project.
