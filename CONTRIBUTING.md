# Contributing to Settlary

Thank you for your interest in contributing to Settlary! This document provides guidelines and information about contributing to this project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Testing](#testing)

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/settlary.git
   cd settlary
   ```
3. **Add the upstream remote**:
   ```bash
   git remote add upstream https://github.com/horn111/settlary.git
   ```
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Setup

### Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0

### Installation

```bash
# Install all dependencies (workspaces)
npm install

# Build the SDK
npm run build --workspace=packages/sdk

# Start the demo app
npm run dev --workspace=apps/demo
```

### Environment Variables

Copy the example environment file for the demo app:

```bash
cp apps/demo/.env.example apps/demo/.env.local
```

Refer to the [Getting Started Guide](docs/getting-started.md) for detailed configuration.

## Making Changes

### Branch Naming Convention

- `feature/` — New features
- `fix/` — Bug fixes
- `docs/` — Documentation updates
- `refactor/` — Code refactoring
- `test/` — Test additions or updates

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(sdk): add per-second billing plan support
fix(middleware): handle malformed x402 payment headers
docs: update architecture diagram
test(buyer): add unit tests for payment retry logic
```

## Pull Request Process

1. **Update documentation** if your change affects public APIs
2. **Add tests** for new functionality
3. **Ensure all checks pass**: `npm run lint && npm run typecheck && npm run test`
4. **Update CHANGELOG.md** under the `[Unreleased]` section
5. **Request review** from maintainers

### PR Checklist

- [ ] Code follows the project's style guidelines
- [ ] Self-review of the code has been performed
- [ ] Comments have been added for complex logic
- [ ] Documentation has been updated
- [ ] Tests have been added/updated
- [ ] All CI checks pass

## Code Style

- **TypeScript** with strict mode enabled
- **Prettier** for formatting (run `npm run format`)
- **ESLint** for linting (run `npm run lint`)
- **No `any` types** — use `unknown` and type guards instead
- **JSDoc comments** for all public APIs

## Testing

```bash
# Run all tests
npm run test

# Run tests for a specific package
npm run test --workspace=packages/sdk

# Run tests in watch mode
npm run test:watch --workspace=packages/sdk
```

## Questions?

Feel free to open a [Discussion](https://github.com/horn111/settlary/discussions) or reach out in the [Circle Discord](https://circle.com/discord).
