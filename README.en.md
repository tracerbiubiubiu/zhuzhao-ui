# zhuzhao-ui — One console for tickets, tasks, and security data

[简体中文](README.md) | [English](README.en.md)

[![CI](https://github.com/tracerbiubiubiu/zhuzhao-ui/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/tracerbiubiubiu/zhuzhao-ui/actions/workflows/ci.yml?query=branch%3Amain)

Manage identities and permissions, move tickets forward, run tasks, and query data in one workspace, with a traceable record of security collaboration.

This repository contains the Vue console for [zhuzhao](https://github.com/tracerbiubiubiu/zhuzhao). The project focuses on data aggregation and security lifecycle management, integrating capabilities from specialist platforms. Start with the [main repository](https://github.com/tracerbiubiubiu/zhuzhao) for the product overview, backend, and full setup. This repository owns the pages, interactions, and frontend requests; business requests go through the zhuzhao gateway.

## What is available today

- **Ticket collaboration:** create, filter, export, and process tickets; custom fields, attachments, comments, CC participants, and tags in ticket details; type/template configuration, a state-flow canvas, and assignment rules.
- **Task center:** submit tasks, inspect runs, manage scheduled job definitions, and investigate cancellations, retries, and dead letters. The backend integrates with taskrunner for execution.
- **Active lists:** browse and maintain typed, structured data, import and export records, and view deprecated types in read-only mode. Access to activelist goes through the gateway.
- **Threat intelligence queries:** query IP addresses, domains, hashes, and URLs; view structured or raw JSON results and query records stored in the current browser. Results come from sources configured in the backend.
- **Identity and administration:** users, organizations, roles, menus, dictionaries, settings, and audit logs; self-service profiles, personal access tokens, and “My organizations.”
- **Messages:** an in-app inbox and unread indicators, plus notification templates, subscription rules, and send logs.

Pages and actions depend on the signed-in user's permissions; the backend makes the final authorization decision. The application UI is currently in Chinese. This English README does not enable an English UI.

Phase 5 has been accepted and merged into main. The new home workspace, full visual redesign, risk lifecycle features, AI/agents, MCP, and enterprise identity integration are planned work. See the [redesign contract](docs/design/frontend-redesign.md) and [main project documentation](https://github.com/tracerbiubiubiu/zhuzhao/tree/main/docs). Design documents and review prototypes are not shipped features.

## Run locally

Use the Node.js version in [.nvmrc](.nvmrc) and the pnpm version pinned in [package.json](package.json). From this repository's root:

```bash
npm install --global "$(node -p 'require("./package.json").packageManager')"
pnpm install --frozen-lockfile
pnpm hooks
pnpm dev
```

Open `http://127.0.0.1:4000`. Login, menus, and business actions require the main backend. The development proxy forwards `/api` and `/al` requests to `http://127.0.0.1:33333`. Task and active-list scenarios also need their upstream services; follow the [development guide](docs/guides/development.md) for the full startup order. Installing the collaboration hooks requires Git and Python 3.

Synthetic mocks remain part of development and state/interaction testing. The existing critical E2E suite uses real backend services. See the [testing guide](docs/guides/testing.md) for the scope and prerequisites of each layer.

## Stack and documentation

Built with Vue 3, TypeScript, Vite, Element Plus, Pinia, and TanStack Query, with LogicFlow for the flow canvas and ECharts for charts. The lockfile is the source for exact dependency versions.

- [Documentation index](docs/README.md): entry points for development, operations, and review.
- [Page and component development](docs/guides/components.md) / [current UI conventions](docs/design/frontend-ui.md): shared components and interaction patterns.
- [Request handling and API consumption](docs/design/request.md): authentication, gateway access, and errors.
- [Build and deployment](docs/ops/deployment.md) / [release and rollback](docs/ops/releasing.md): static assets and the same-origin reverse proxy.
- [Review and verification records](docs/review/README.md): the version, environment, and limits behind each report.

Most detailed documentation is currently in Chinese.

## Contribute

Reproducible bug reports and concrete use cases are welcome in [Issues](https://github.com/tracerbiubiubiu/zhuzhao-ui/issues), as are focused pull requests. Read the [contribution guide](docs/contributing.md) and [AGENTS.md](AGENTS.md), keep tests first, and run `pnpm gate` before submitting. Prepare an exclusive environment for checks that require the real service stack.

Use synthetic data for examples, mocks, and screenshots. Do not commit company information, credentials, or real business data. If you find the project useful, consider giving the [main project](https://github.com/tracerbiubiubiu/zhuzhao) a Star.

## License

[MIT License](LICENSE).
