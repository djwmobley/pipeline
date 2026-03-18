# Sector Recommendations by Framework

Use the detected framework to recommend sectors. Each framework has established conventions for how code is organized — sectors should follow these conventions, not fight them.

**JavaScript/TypeScript Web Frameworks:**

| Framework | Sectors |
|-----------|---------|
| **Next.js (App Router)** | Pages & Layouts (`app/**/page.tsx`, `app/**/layout.tsx`), API Routes (`app/api/**`), Components (`src/components/**`, `components/**`), Data & State (`src/lib/**`, `src/hooks/**`, `src/stores/**`), Config & Middleware (`middleware.ts`, `next.config.*`) |
| **Next.js (Pages Router)** | Pages (`pages/**`, excluding `pages/api/`), API Routes (`pages/api/**`), Components (`src/components/**`, `components/**`), Data & State (`src/lib/**`, `src/hooks/**`, `src/stores/**`), Config (`next.config.*`) |
| **Nuxt** | Pages (`pages/**`), Components (`components/**`), Composables & State (`composables/**`, `stores/**`), Server (`server/**`), Plugins & Config (`plugins/**`, `nuxt.config.*`) |
| **SvelteKit** | Routes (`src/routes/**`), Components (`src/lib/components/**`), Library (`src/lib/**` excluding components), Server (`src/hooks.*`, `src/routes/**/+server.*`) |
| **Remix** | Routes (`app/routes/**`), Components (`app/components/**`), Models & Data (`app/models/**`, `app/utils/**`), Server (`app/entry.server.*`, `app/root.*`) |
| **Angular** | Feature Modules (`src/app/features/**` or `src/app/<feature>/`), Shared (`src/app/shared/**`), Core Services (`src/app/core/**`), Routing (`src/app/app-routing.*`, `src/app/*-routing.*`) |
| **Astro** | Pages (`src/pages/**`), Components (`src/components/**`), Layouts (`src/layouts/**`), Content (`src/content/**`) |

**React/Vue SPA (no meta-framework):**

| Framework | Sectors |
|-----------|---------|
| **React + Vite/CRA** | Components (`src/components/**`), Pages & Routing (`src/pages/**`, `src/routes/**`), State & Hooks (`src/hooks/**`, `src/stores/**`, `src/context/**`), Services & API (`src/services/**`, `src/api/**`), Utilities (`src/utils/**`, `src/lib/**`) |
| **Vue + Vite** | Components (`src/components/**`), Views & Routing (`src/views/**`, `src/router/**`), Composables & Stores (`src/composables/**`, `src/stores/**`), Services (`src/services/**`, `src/api/**`), Utilities (`src/utils/**`) |

**Mobile:**

| Framework | Sectors |
|-----------|---------|
| **React Native / Expo** | Screens & Navigation (`src/screens/**`, `src/navigation/**`, `app/(tabs)/**`), Components (`src/components/**`), State & Services (`src/hooks/**`, `src/stores/**`, `src/services/**`, `src/api/**`), Native & Platform (`ios/**`, `android/**`, `src/native/**`) |
| **Capacitor (web + native)** | Shared UI (`src/components/**`), Pages (`src/pages/**`, `src/routes/**`), Platform Bridge (`src/native/**`, `src/platform/**`, `capacitor.config.*`), State & Services (`src/hooks/**`, `src/stores/**`, `src/services/**`), Native Projects (`ios/**`, `android/**`) |

**Node.js API:**

| Framework | Sectors |
|-----------|---------|
| **Express / Fastify / Koa / Hono** | Routes & Controllers (`src/routes/**`, `src/controllers/**`, `routes/**`), Middleware (`src/middleware/**`, `middleware/**`), Models & Data (`src/models/**`, `src/db/**`, `prisma/**`, `drizzle/**`), Services & Logic (`src/services/**`, `src/utils/**`), Config & Entry (`src/config/**`, `src/app.*`, `src/index.*`) |

**Python:**

| Framework | Sectors |
|-----------|---------|
| **Django** | Per-app: each Django app (`<app>/models.py`, `<app>/views.py`, `<app>/urls.py`, `<app>/serializers.py`, `<app>/admin.py`) is one sector. Plus a shared sector for `settings.py`, `urls.py`, templates, static. Detect apps by looking for directories containing `models.py`. |
| **FastAPI** | Routers (`app/routers/**`, `app/api/**`), Models & Schemas (`app/models/**`, `app/schemas/**`), Services (`app/services/**`, `app/crud/**`), Config & Dependencies (`app/core/**`, `app/deps.*`, `app/config.*`) |
| **Flask** | Blueprints (`app/blueprints/**`, `app/routes/**`, `app/views/**`), Models (`app/models/**`), Services (`app/services/**`), Config & Extensions (`app/config.*`, `app/extensions.*`) |

**Go:**

| Framework | Sectors |
|-----------|---------|
| **Go standard (cmd/ + internal/)** | Commands (`cmd/**`), Internal packages (`internal/**` — one sector per major package or group), Public API (`pkg/**`) |
| **Echo / Gin / Fiber** | Handlers (`handlers/**`, `api/**`), Middleware (`middleware/**`), Models & DB (`models/**`, `db/**`, `repository/**`), Services (`services/**`, `pkg/**`) |

**Rust:**

| Framework | Sectors |
|-----------|---------|
| **Axum / Actix** | Handlers (`src/handlers/**`, `src/routes/**`), Models (`src/models/**`, `src/db/**`), Middleware & Extractors (`src/middleware/**`, `src/extractors/**`), Services (`src/services/**`) |
| **Clap CLI** | Commands (`src/commands/**`, `src/cli/**`), Core Logic (`src/lib.rs`, `src/core/**`), I/O (`src/output/**`, `src/input/**`) |

**Ruby:**

| Framework | Sectors |
|-----------|---------|
| **Rails** | Models & DB (`app/models/**`, `db/**`), Controllers & Routes (`app/controllers/**`, `config/routes.rb`), Views & Assets (`app/views/**`, `app/assets/**`, `app/javascript/**`), Services & Jobs (`app/services/**`, `app/jobs/**`, `app/mailers/**`), Config & Lib (`config/**`, `lib/**`) |

**Java/Kotlin:**

| Framework | Sectors |
|-----------|---------|
| **Spring Boot** | Controllers (`**/controllers/**`, `**/rest/**`), Services (`**/services/**`, `**/service/**`), Repositories & Models (`**/repositories/**`, `**/models/**`, `**/entities/**`), Config & Security (`**/config/**`, `**/security/**`) |
| **Ktor** | Routes (`**/routes/**`, `**/plugins/**`), Models (`**/models/**`), Services (`**/services/**`), Config (`**/config/**`, `application.conf`) |
