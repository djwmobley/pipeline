# Framework-Specific Security Checklists

> **Fallback rule:** If the detected framework is not listed here, specialists fall back to generic domain checklists from specialist-domains.md.

These checklists supplement (not replace) the generic domain checklists. The recon agent detects the framework; the orchestrator pulls the relevant section and injects it into each specialist's prompt via the `[FRAMEWORK_CHECKLIST]` placeholder.

---

## 1. Next.js

### INJ
- Check Server Actions for unsanitized form data passed to database queries or shell commands
- Check API route handlers (`app/api/**/route.ts`) for string-interpolated queries
- Check `generateMetadata` and `generateStaticParams` for injection via dynamic route segments

### AUTH
- Verify every Server Action checks session/auth before mutating data — Server Actions are public HTTP endpoints
- Check `middleware.ts` for auth bypass via path matching gaps (trailing slashes, encoded characters, `_next/` prefix)
- Verify API routes in `app/api/` check auth — they are not protected by page-level layouts
- Check for session token exposure in RSC payloads returned to the client

### XSS
- Search for `dangerouslySetInnerHTML` — verify all inputs are sanitized with a proper library (not regex)
- Check RSC (React Server Component) serialization boundaries — data passed from server to client components via props
- Check `next/head` or metadata API for unsanitized user input in meta tags

### CSRF
- Verify Server Actions validate origin header or use CSRF tokens — Next.js does not add CSRF protection by default
- Check that API routes handling mutations require appropriate CSRF protection

### CONFIG
- Search for `NEXT_PUBLIC_` env vars — these are embedded in client JS bundles; verify none contain secrets
- Check `next.config.js` for missing or weak CSP headers, permissive `images.remotePatterns`, disabled security headers
- Check for `output: 'export'` exposing server-intended logic in static builds
- Verify `poweredByHeader` is set to `false`

### DATA
- Check RSC data serialization — server-fetched data passed to client components may leak internal fields
- Verify `revalidate` and cache settings do not serve stale authenticated data to wrong users
- Check API routes returning full database objects without field filtering

### ACL
- Verify parallel route and intercepting route segments enforce the same auth as the pages they replace
- Check that `middleware.ts` matcher patterns cover all protected routes (including API routes)
- Verify Server Actions check authorization (not just authentication) — user A cannot mutate user B's data

---

## 2. Nuxt

### INJ
- Check `server/api/` and `server/routes/` handlers for unsanitized `getQuery()`, `readBody()`, or `getRouterParam()` in database queries
- Check `server/middleware/` for injection via header or cookie values

### AUTH
- Verify `server/middleware/` auth checks cannot be bypassed via direct API route access
- Check that `useFetch`/`useAsyncData` calls to authenticated endpoints pass credentials correctly
- Verify auth state is not solely managed client-side via `useState` composable

### XSS
- Search for `v-html` directive usage — verify the bound value is sanitized
- Check server-rendered content for unsanitized user input in SSR templates

### CSRF
- Verify mutations via `useFetch` include CSRF tokens — Nuxt does not add CSRF protection automatically
- Check `server/api/` POST/PUT/DELETE handlers for CSRF validation

### CONFIG
- Check `nuxt.config.ts` `runtimeConfig` — `public` block is exposed to client; verify no secrets in `runtimeConfig.public`
- Verify `runtimeConfig` private keys are not accidentally referenced in client-side composables
- Check for missing security headers in `routeRules` or nitro config

### DATA
- Check `server/api/` endpoints for over-fetching — returning full database objects instead of projections
- Verify `useAsyncData` payloads serialized to client do not contain internal fields

### ACL
- Verify `server/middleware/` auth runs before all protected `server/api/` routes
- Check `definePageMeta({ middleware })` coverage on protected pages — missing middleware means no auth

---

## 3. SvelteKit

### INJ
- Check `+server.ts` request handlers and `+page.server.ts` actions for unsanitized `request.formData()` or `url.searchParams` in queries
- Check `hooks.server.ts` handle function for injection via request properties

### AUTH
- Verify `hooks.server.ts` `handle` function validates sessions — this is the central auth gate
- Check `+page.server.ts` `load` functions for missing auth checks (load functions run on every navigation)
- Verify form actions in `+page.server.ts` check auth before mutations — actions are public POST endpoints

### XSS
- Search for `{@html ...}` syntax — verify all bound values are sanitized
- Check `+server.ts` endpoints returning HTML content type for unsanitized content

### CONFIG
- Check `$env/static/public` and `$env/dynamic/public` imports — these are client-exposed; verify no secrets
- Verify `$env/static/private` and `$env/dynamic/private` are never imported in client-side code (`+page.svelte`)
- Check `svelte.config.js` CSP configuration

### DATA
- Check `+page.server.ts` and `+layout.server.ts` load functions — returned data is serialized to the client
- Verify load functions do not return full database objects or internal fields

### ACL
- Verify `hooks.server.ts` handle function covers all route groups — check for route pattern gaps
- Check that `+layout.server.ts` auth guards apply to all child routes (verify no `+page.server.ts` bypasses layout load)

---

## 4. Remix

### INJ
- Check `loader` and `action` functions for unsanitized `request.formData()`, `params`, or URL search params in database queries
- Check resource routes (`.server.ts` files) for injection in data processing

### AUTH
- Verify every `loader` and `action` checks session authentication — these are independent HTTP handlers, not protected by parent layouts at the HTTP level
- Check `createCookieSessionStorage` secret strength and rotation — weak secrets allow session forgery
- Verify session cookie uses `httpOnly`, `secure`, `sameSite` flags

### XSS
- Search for `dangerouslySetInnerHTML` in route components
- Check `loader` functions returning HTML strings that get rendered in the UI

### CONFIG
- Verify `.env` values are not directly returned from `loader` functions to the client
- Check `entry.server.tsx` for missing security headers in the streaming response

### DATA
- Check `loader` functions for over-fetching — returning full database objects that serialize into page data
- Verify `action` return values do not leak internal error details

### ACL
- Verify every route `loader` and `action` performs authorization (not just authentication)
- Check pathless layout routes — auth in a layout `loader` does not protect child `action` functions

---

## 5. Astro

### INJ
- Check `src/pages/api/` endpoints for unsanitized `Astro.url.searchParams` or request body in queries
- Check `.astro` component frontmatter scripts for injection via dynamic route params

### AUTH
- Verify API endpoints in `src/pages/api/` implement auth checks — Astro has no built-in auth middleware
- Check SSR middleware (if using `@astrojs/node` or similar) for auth bypass via path manipulation

### XSS
- Search for `set:html` directive — verify all bound content is sanitized
- Check `<Fragment set:html={...} />` usage for unsanitized dynamic content

### CONFIG
- Check for secrets in `.astro` component frontmatter that may leak into static HTML during build
- Verify `astro.config.mjs` does not expose sensitive `vite.define` values
- Check for `import.meta.env.PUBLIC_` vars containing secrets

### DATA
- In SSR mode, verify endpoint responses do not leak server-side data
- In static mode, verify build output does not contain secrets or internal data baked into HTML/JSON

---

## 6. Angular

### INJ
- Check for `bypassSecurityTrustHtml`, `bypassSecurityTrustScript`, `bypassSecurityTrustUrl`, `bypassSecurityTrustResourceUrl` — each disables Angular's built-in sanitizer
- Check HTTP service methods for string-interpolated API URLs with user input

### AUTH
- Verify route guards (`CanActivate`, `CanActivateChild`, `CanMatch`) cover all protected routes
- Check that HTTP interceptors attach auth tokens and handle 401 responses correctly
- Verify guards cannot be bypassed by navigating directly to lazy-loaded child routes

### XSS
- Search for `[innerHTML]` bindings — Angular sanitizes by default, but check for `bypassSecurityTrust*` wrappers on the input
- Check custom pipes for unsafe HTML construction
- Check for template injection via user-controlled component inputs

### CONFIG
- Check `environment.ts` / `environment.prod.ts` for secrets — these files are bundled into client JS
- Verify `angular.json` budgets and build config do not include source maps in production

### ACL
- Verify route guards check authorization roles, not just authentication status
- Check lazy-loaded module routes for missing guard inheritance from parent routes

### DATA
- Check HTTP interceptors for logging or caching that may expose auth tokens or PII
- Verify error interceptors do not surface internal API error details to the UI

---

## 7. React + Vite

### INJ
- Check for user input passed to `eval()`, `Function()`, or template literal strings used as code

### AUTH
- Verify client-side route guards are supplemented by server-side auth — React Router guards are trivially bypassed
- Check token storage — `localStorage` is XSS-accessible; prefer `httpOnly` cookies

### XSS
- Search for `dangerouslySetInnerHTML` — verify all inputs are sanitized
- Check for third-party script injection via `<script>` tags dynamically inserted into DOM
- Check `ref` usage that directly manipulates `innerHTML`

### CONFIG
- Search for `VITE_` env vars — these are embedded in client bundles; verify none contain secrets
- Check `vite.config.ts` for `define` values exposing secrets
- Verify production builds do not include source maps

### DATA
- Check API response handlers for logging or state management that stores sensitive data in browser-accessible locations

---

## 8. Vue + Vite

### INJ
- Check for user input passed to `eval()` or dynamically constructed component rendering

### AUTH
- Verify Vue Router navigation guards (`beforeEach`, `beforeEnter`) are backed by server-side auth
- Check token storage — `localStorage` is XSS-accessible; prefer `httpOnly` cookies

### XSS
- Search for `v-html` directive — verify all bound values are sanitized
- Check render functions for `innerHTML` or `domProps: { innerHTML }` usage
- Check custom directives that manipulate DOM for injection vectors

### CONFIG
- Search for `VITE_` env vars — these are embedded in client bundles; verify none contain secrets
- Check `vite.config.ts` for `define` values exposing secrets

### DATA
- Check Pinia/Vuex stores for sensitive data that persists in browser memory or plugin-based persistence

---

## 9. React Native / Expo

### AUTH
- Check token storage: `AsyncStorage` is unencrypted; verify tokens use `expo-secure-store` (Expo) or `react-native-keychain`
- Verify deep link URI handlers (`Linking`, `expo-router`) validate and sanitize incoming URL parameters
- Check biometric auth flows for fallback bypass — ensure server validates auth, not just the client

### CRYPTO
- Verify TLS certificate pinning is configured for production API connections
- Check for hardcoded API keys or secrets in JS bundles — React Native JS is extractable from APK/IPA

### CONFIG
- Check `app.json` / `app.config.js` for exposed API keys, webhook URLs, or internal endpoints
- Verify `expo-constants` values do not contain secrets accessible at runtime
- Check EAS build config for secrets in `eas.json`

### DATA
- Check for sensitive data logged via `console.log` in production builds
- Verify clipboard operations do not expose tokens or passwords
- Check `expo-file-system` or `AsyncStorage` for unencrypted PII storage

### DEPS
- Check native module dependencies for known CVEs — npm audit does not cover native code
- Verify Expo SDK version for known security patches

### ACL
- Verify all authorization checks happen server-side — client-side role checks are trivially bypassed
- Check navigation guards for sensitive screens

### CERT
- Verify TLS certificate pinning for production API endpoints
- Check for `expo-dev-client` or debug networking tools left enabled in production builds

---

## 10. Capacitor / Ionic

### AUTH
- Check token storage: `Preferences` (formerly `Storage`) plugin is unencrypted; verify tokens use `@capacitor/secure-storage` or native keychain
- Verify deep link and universal link handlers validate URI parameters before navigation
- Check web view cookie handling — `SameSite` and `Secure` flags may not apply in embedded web views

### XSS
- Web view renders HTML — standard XSS vectors apply; check for `innerHTML`, `v-html`, or `dangerouslySetInnerHTML` in the web app
- Verify Capacitor HTTP plugin responses are not rendered as raw HTML

### CRYPTO
- Verify TLS certificate pinning via `@capacitor/http` or native plugin
- Check for plaintext HTTP allowed in `capacitor.config.ts` (`server.cleartext`)

### CONFIG
- Check `capacitor.config.ts` for hardcoded API URLs, keys, or tokens
- Verify `server.url` is not set to a development server in production builds
- Check native plugin permissions — verify only required permissions are declared (camera, location, etc.)

### DATA
- Verify `Preferences` plugin does not store PII or tokens unencrypted
- Check `@capacitor/filesystem` usage for sensitive data written to accessible storage locations

### CERT
- Verify HTTPS enforcement — check `capacitor.config.ts` `server.cleartext` is false
- Check `@capacitor/http` native bridge for certificate validation

---

## 11. Flutter

### AUTH
- Check token storage: `SharedPreferences` is unencrypted; verify tokens use `flutter_secure_storage`
- Verify deep link URI scheme handlers validate and sanitize parameters before navigation
- Check biometric auth (`local_auth`) for server-side enforcement — client-only biometric checks are bypassable

### CRYPTO
- Verify TLS certificate pinning via `SecurityContext` or `http_certificate_pinning` package
- Check for hardcoded keys in Dart source — Dart compiles to readable snapshots

### CONFIG
- Check Dart files for hardcoded API keys, Firebase configs, or internal URLs
- Verify `--dart-define` build-time values do not contain production secrets in CI/CD logs
- Check `AndroidManifest.xml` and `Info.plist` for exposed keys or debug flags

### DATA
- Verify `SharedPreferences` does not store PII or tokens
- Check `path_provider` file storage for unencrypted sensitive data
- Check for sensitive data in debug logs (`print()`, `debugPrint()`, `log()`)

### DEPS
- Check `pubspec.yaml` dependencies for known vulnerabilities
- Verify native platform plugin versions for security patches

### ACL
- Verify all authorization checks happen server-side — Dart client-side checks are trivially bypassable

### CERT
- Verify TLS certificate pinning in production HTTP client configuration
- Check `android/app/src/main/res/xml/network_security_config.xml` for cleartext traffic permissions

---

## 12. Express

### INJ
- Check route handlers for string-concatenated SQL/NoSQL queries — verify parameterized queries or ORM usage
- Check for unsanitized user input in OS command arguments via child process APIs
- Check for user-controlled input in `eval()`, `Function()`, or `vm.runInContext()`

### AUTH
- Verify middleware ordering: auth middleware must run before route handlers, not after
- Check session config: `cookie.secure` should be true in production, `cookie.httpOnly` should be true, `cookie.sameSite` set
- Verify session secret is not hardcoded — check for `process.env` usage and rotation support
- Check `passport.js` strategy config for callback URL validation

### XSS
- Verify response `Content-Type` headers are set correctly — especially for endpoints returning user-generated content
- Check template engine (EJS, Pug, Handlebars) for unescaped output (`<%- %>`, `!{...}`, `{{{ }}}`)

### CSRF
- Verify CSRF middleware (`csurf` or equivalent) is applied to state-changing routes
- Check that API routes serving both browser and machine clients handle CSRF appropriately

### CONFIG
- Verify `helmet` middleware is configured — check for missing or overly permissive options
- Check `body-parser` / `express.json()` limits — missing `limit` option allows large payload DoS
- Verify `trust proxy` setting matches deployment — incorrect value breaks rate limiting and IP logging
- Check for verbose error handlers leaking stack traces in production

### RATE
- Verify rate limiting middleware (`express-rate-limit` or equivalent) is applied before auth and route handlers
- Check rate limit config: window size, max requests, key generator (IP vs user vs combined)

### ACL
- Check middleware ordering — verify authorization middleware runs after authentication
- Verify route-specific middleware is not missing on individual routes added later

---

## 13. Fastify

### INJ
- Check route handlers for raw SQL — verify use of parameterized queries
- Check that Fastify schema validation is defined for all user-facing routes (missing schemas skip validation entirely)

### AUTH
- Verify `@fastify/auth` or custom auth hooks run via `preHandler` or `onRequest` — not just on some routes
- Check plugin encapsulation — auth plugins registered in a child context do not protect sibling contexts

### XSS
- Check responses with `text/html` content type for unsanitized user input
- Verify `@fastify/view` template rendering escapes by default

### CONFIG
- Check `@fastify/cors` config — verify `origin` callback or allowlist is not overly permissive
- Check `@fastify/rate-limit` plugin config: verify it is registered and covers all routes
- Check request logging for PII exposure — Fastify logs request/response by default

### RATE
- Verify `@fastify/rate-limit` is registered globally or per-route — missing registration means no rate limiting
- Check rate limit key generator — default uses IP, which is bypassable behind shared proxies

### DATA
- Check serialization schemas — missing `response` schemas may leak internal fields from database objects
- Verify error handler does not expose stack traces or internal details

---

## 14. Hono

### INJ
- Check route handlers for unsanitized `c.req.query()`, `c.req.param()`, `c.req.parseBody()` in database queries
- Check middleware for injection via header values

### AUTH
- Verify JWT middleware (`hono/jwt`) is applied to all protected routes — check middleware chain ordering
- Check Bearer token extraction and validation config

### XSS
- Verify `c.html()` responses sanitize dynamic content
- Check JSX responses for unsanitized user input

### CONFIG
- Check CORS middleware config — verify `origin` is not `*` for authenticated endpoints
- Verify validator middleware (`hono/validator`) is applied to routes accepting user input — missing validators skip all input checking

### RATE
- Check for rate limiting middleware — Hono has no built-in rate limiter; verify third-party or custom implementation exists

### ACL
- Verify middleware chain ordering — auth middleware must precede route handlers in the chain
- Check grouped routes for missing middleware inheritance

---

## 15. Koa

### INJ
- Check route handlers (via `koa-router` or `@koa/router`) for raw SQL with `ctx.query`, `ctx.params`, or `ctx.request.body`
- Check for template string injection via request properties

### AUTH
- Verify auth middleware is registered before route middleware in the cascade — Koa middleware runs in order of `app.use()`
- Check session config (`koa-session`): verify `httpOnly`, `secure`, `sameSite` cookie flags, strong secret key

### XSS
- Check `ctx.body` assignments returning HTML — verify user-controlled content is sanitized
- Check template engines for unescaped output directives

### CONFIG
- Check `@koa/cors` config — verify origin allowlist or callback
- Check for missing body parser limits (large payload DoS)

### RATE
- Verify rate limiting middleware is registered — Koa has no built-in rate limiter

### ACL
- Check middleware cascade ordering — authorization must follow authentication in the `app.use()` chain
- Verify per-route middleware is applied on all protected router endpoints

---

## 16. Django

### INJ
- Search for `.raw()`, `.extra()`, `RawSQL()`, `connection.cursor().execute()` with string formatting — verify parameterized queries
- Check `Q()` objects and `__regex`/`__contains` lookups for user-controlled input
- Check management commands for OS command injection via `subprocess` with user input

### AUTH
- Verify `@login_required` or `LoginRequiredMixin` on all non-public views — check for missing decorators
- Check `AUTHENTICATION_BACKENDS` for overly permissive custom backends
- Verify password validation: `AUTH_PASSWORD_VALIDATORS` should not be empty

### XSS
- Verify template auto-escaping is not disabled via `{% autoescape off %}` blocks
- Search for `|safe` filter and `mark_safe()` calls — verify all inputs are pre-sanitized
- Check `JsonResponse` and custom responses for unsanitized content in non-HTML responses

### CSRF
- Verify `django.middleware.csrf.CsrfViewMiddleware` is in `MIDDLEWARE` — not removed or commented out
- Search for `@csrf_exempt` decorator — verify each usage is justified (API endpoints with token auth, webhooks)
- Check AJAX calls for `X-CSRFToken` header inclusion

### CONFIG
- Check `settings.py`: `DEBUG` must be `False`, `SECRET_KEY` must not be hardcoded, `ALLOWED_HOSTS` must not be `['*']`
- Verify `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SESSION_COOKIE_HTTPONLY` are `True`
- Check `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS`, `SECURE_HSTS_INCLUDE_SUBDOMAINS`
- Verify admin panel URL is not `/admin/` (predictable) — or is restricted by IP/VPN

### DATA
- Check serializers and `values()` calls for over-fetching — verify internal fields (passwords, tokens) are excluded
- Verify Django REST Framework serializer `fields` are explicit, not `__all__`
- Check `FileResponse` and media serving for path traversal

### ACL
- Verify `@permission_required` or `PermissionRequiredMixin` on views requiring specific roles
- Check Django REST Framework `permission_classes` — verify not set to `AllowAny` on sensitive endpoints
- Verify object-level permissions for multi-tenant data access

---

## 17. FastAPI

### INJ
- Check for raw SQL via SQLAlchemy `text()`, `session.execute()` with string formatting, or `engine.execute()` with f-strings
- Check ORM queries for user-controlled `.filter()` arguments that could manipulate query logic

### AUTH
- Verify `Depends()` auth chains on all protected endpoints — missing dependency means no auth
- Check OAuth2 scope validation — verify scopes are checked, not just token validity
- Verify `HTTPBearer` / `OAuth2PasswordBearer` token validation includes expiry and issuer checks

### XSS
- Check `HTMLResponse` or `Jinja2Templates` for unsanitized user input in rendered content

### CONFIG
- Check `CORSMiddleware` config: verify `allow_origins` is not `["*"]` for authenticated APIs
- Verify `allow_credentials=True` is not combined with `allow_origins=["*"]`
- Check for missing rate limiting — FastAPI has no built-in rate limiter

### RATE
- Verify rate limiting exists — FastAPI has no built-in solution; check for `slowapi` or custom middleware

### DATA
- Verify Pydantic response models filter out internal fields — check for endpoints returning ORM objects directly
- Check `response_model_include`/`response_model_exclude` for completeness
- Verify error handlers do not leak internal exception details or stack traces

### ACL
- Verify endpoint-level authorization, not just authentication — check that user A cannot access user B's resources
- Check `Depends()` chains for authorization logic after authentication

---

## 18. Flask

### INJ
- Check for raw SQL via `db.engine.execute()`, `db.session.execute()`, or `cursor.execute()` with string formatting
- Check for user-controlled command arguments in OS command calls
- Check Jinja2 template rendering with `render_template_string()` for server-side template injection

### AUTH
- Verify `@login_required` (Flask-Login) or `before_request` auth hooks cover all protected routes
- Check for routes added after the `before_request` hook that bypass auth
- Verify session cookie config: `SESSION_COOKIE_SECURE`, `SESSION_COOKIE_HTTPONLY`, `SESSION_COOKIE_SAMESITE`

### XSS
- Verify Jinja2 auto-escaping is enabled — check for `Markup()`, `|safe` filter, or `{% autoescape false %}`
- Check `make_response()` with HTML content type for unsanitized output

### CSRF
- Verify Flask-WTF CSRF protection is enabled and covers all forms
- Check API endpoints for CSRF protection or token-based auth exemption

### CONFIG
- Check `SECRET_KEY` — must not be hardcoded or weak; verify `os.environ` usage
- Verify `DEBUG` is `False` in production — debug mode enables interactive debugger (RCE)
- Check for Flask debug PIN exposure in error pages
- Verify `PREFERRED_URL_SCHEME` is `https` in production

### DATA
- Check JSON responses for over-fetching — returning full SQLAlchemy model data without filtering
- Verify file download routes check path traversal (`../`)

### ACL
- Verify `@login_required` checks authorization, not just authentication — or add separate role checks
- Check blueprint-level `before_request` hooks for coverage gaps

---

## 19. Laravel

### INJ
- Search for `DB::raw()`, `DB::statement()`, `whereRaw()`, `selectRaw()`, `orderByRaw()` with variable interpolation — verify bound parameters
- Check Eloquent `::fromQuery()` and raw expressions for user-controlled input
- Check Blade `@php` blocks for OS command execution

### AUTH
- Verify `auth` middleware is applied to all protected routes — check `routes/web.php` and `routes/api.php`
- Check middleware groups in `app/Http/Kernel.php` — verify `auth` is in the correct groups
- Verify `Gate` and `Policy` definitions cover all sensitive model operations

### XSS
- Search for `{!! !!}` Blade syntax — this outputs unescaped HTML; verify all inputs are sanitized
- Check `@php echo` and `<?= ?>` in templates for unescaped output
- Verify `{{ }}` is used for user-controlled output (auto-escaped)

### CSRF
- Check `VerifyCsrfToken` middleware `$except` array — verify excluded routes are intentional (webhooks, APIs with token auth)
- Verify all forms use `@csrf` directive

### CONFIG
- Check `.env` file: `APP_DEBUG` must be `false`, `APP_KEY` must be set and not committed to version control
- Verify `APP_ENV` is `production` in deployed config
- Check `config/*.php` for hardcoded secrets instead of `env()` calls

### DATA
- Check Eloquent models for mass assignment: verify `$fillable` or `$guarded` is set — missing both allows mass assignment of any attribute
- Verify API Resources and `toArray()` overrides filter out internal fields (passwords, tokens, pivot data)
- Check `Storage::download()` and file serving for path traversal

### ACL
- Verify Policy `before()` method does not grant blanket admin access that bypasses all checks
- Check route model binding — verify `authorizeResource()` or per-method policy checks exist
- Verify `Gate::allows()` checks on all sensitive operations

---

## 20. Rails

### INJ
- Search for `find_by_sql`, `execute`, `where("... #{...}")`, `order(params[:sort])` — verify parameterized queries or `sanitize_sql`
- Check for user-controlled command arguments in system call methods
- Check ERB templates for `render inline:` with user input (server-side template injection)

### AUTH
- Verify `before_action` filter coverage — check for `skip_before_action` that removes auth on sensitive actions
- Check Devise configuration: password length, lockout, confirmable, session timeout
- Verify API authentication (token or JWT) on all API controller actions

### XSS
- Search for `raw()`, `html_safe`, `safe_concat`, `sanitize` with permissive config — these bypass Rails auto-escaping
- Check `content_tag` and helpers for unsanitized user input in attributes
- Verify `protect_from_forgery` is not skipped in controllers serving HTML

### CSRF
- Verify `protect_from_forgery with: :exception` is in `ApplicationController` — not `:null_session` (which silently drops auth)
- Check API controllers for `skip_before_action :verify_authenticity_token` — verify they use token-based auth instead

### CONFIG
- Check `config/credentials.yml.enc` or `config/secrets.yml` — verify `secret_key_base` is strong and not committed in plaintext
- Verify `config.force_ssl = true` in production
- Check `config/environments/production.rb` for `config.consider_all_requests_local = false`
- Verify `config/initializers/filter_parameter_logging.rb` filters passwords, tokens, secrets

### DATA
- Check `to_json`, `as_json`, `render json:` without explicit `only:` or serializer — may expose all model attributes
- Verify ActiveStorage direct upload URLs do not leak private file access
- Check strong parameters — verify `permit!` is not used (allows all attributes)

### ACL
- Verify Pundit policies or CanCanCan abilities cover all controller actions
- Check for `skip_authorization` in controllers
- Verify strong parameters — `params.permit!` allows mass assignment of any attribute including `admin`, `role`

---

## 21. Echo / Gin / Fiber (Go)

### INJ
- Check `database/sql` query calls for string concatenation or `fmt.Sprintf` with user input — verify `$1` or `?` placeholders
- Check GORM `Raw()`, `Exec()`, `Where()` with string formatting for user input
- Check `os/exec.Command()` for unsanitized user input in arguments

### AUTH
- Verify auth middleware is registered on all protected route groups — check for routes added outside the auth group
- Check JWT middleware config: verify signing algorithm (no `none` algorithm), secret key strength, expiry validation
- Verify session/cookie config flags: `HttpOnly`, `Secure`, `SameSite`

### CONFIG
- Check for secrets read from environment variables — verify they are not also hardcoded as fallback defaults
- Verify CORS middleware config: check `AllowOrigins` is not `*` for authenticated APIs
- Check for missing rate limiting middleware
- Verify production mode is set in deployment (`GIN_MODE=release` or equivalent)

### RATE
- Verify rate limiting middleware is registered — Go frameworks have no built-in rate limiting
- Check rate limiter store (in-memory vs Redis) — in-memory does not work with multiple instances

### ACL
- Verify middleware group coverage — routes registered outside a group skip its middleware
- Check handler-level authorization after authentication

### DATA
- Check JSON serialization — Go structs serialize all exported fields by default; verify `json:"-"` on sensitive fields
- Verify error responses do not include internal error messages or stack traces

### CERT
- Verify TLS configuration if terminating TLS in the application
- Check for HTTP redirect to HTTPS enforcement

---

## 22. Axum / Actix (Rust)

### INJ
- Check `sqlx::query!` vs `sqlx::query()` — the macro variant checks at compile time; `query()` with `format!()` is injectable
- Check `sea-orm` `Statement::from_string()` and `JsonValue` queries for user input
- Verify no `std::process::Command` with unsanitized user input

### AUTH
- Verify `tower` middleware layers include auth — check `ServiceBuilder` layer ordering
- Check Axum extractor ordering — extractors run in parameter order; auth extractors should come first
- Verify `actix-web` middleware ordering in `App::new()` chain

### CONFIG
- Check for secrets in `dotenv` / `.env` files committed to version control
- Verify compile-time (`env!()`) vs runtime (`std::env::var()`) secret loading — `env!()` embeds the value in the binary
- Check CORS configuration via `tower-http::cors` or `actix-cors`

### DATA
- Verify `serde::Serialize` derive on response types does not include internal fields — use `#[serde(skip)]` on sensitive fields
- Check error handlers for internal detail leakage

### ACL
- Verify Tower layer ordering in Axum — layers apply in reverse registration order
- Check Actix guard and middleware scope for route coverage gaps

### RATE
- Verify rate limiting middleware exists — neither Axum nor Actix includes one by default
- Check `tower::limit::RateLimitLayer` or `actix-limitation` configuration

---

## 23. Spring Boot

### INJ
- Check `@Query` annotations for string concatenation in JPQL/HQL — verify `:paramName` named parameters or `?1` positional params
- Check `JdbcTemplate` `.query()`, `.update()` for string concatenation — verify `?` placeholders
- Check `@RequestParam` or `@PathVariable` values used in OS command execution

### AUTH
- Verify `@PreAuthorize`, `@Secured`, or `@RolesAllowed` on all controller methods — or `SecurityFilterChain` URL-based rules
- Check `SecurityFilterChain` config for `.permitAll()` on sensitive endpoints
- Verify `HttpSecurity` CSRF config — not disabled without justification

### XSS
- Check Thymeleaf templates for `th:utext` (unescaped) — verify all user content uses `th:text` (escaped)
- Check `@ResponseBody` endpoints returning HTML strings with user input

### CONFIG
- Check `application.properties` / `application.yml` for hardcoded secrets — verify `${ENV_VAR}` or Vault references
- Verify Actuator endpoints are secured: `/actuator/env`, `/actuator/configprops`, `/actuator/heapdump` expose secrets
- Check `management.endpoints.web.exposure.include` — should not be `*`
- Verify `server.error.include-stacktrace` is not `always`

### CSRF
- Verify CSRF is not globally disabled — check for `.csrf(csrf -> csrf.disable())` paired with token auth justification
- Check CSRF token repository configuration for SPAs

### DATA
- Verify JPA entity serialization — `@JsonIgnore` on sensitive fields (password, tokens)
- Check `@RestController` response types for over-fetching from database
- Verify error responses do not include `trace` or internal exception details

### ACL
- Verify method-level security annotations match URL-based security rules — gaps create bypasses
- Check `@PostAuthorize` usage for authorization after data retrieval
- Verify multi-tenant data isolation in repository queries

---

## 24. Ktor

### INJ
- Check Exposed framework raw SQL and `TransactionManager.current().exec()` for string concatenation with user input
- Check `java.sql` usage for parameterized queries

### AUTH
- Verify `authenticate("auth-name") { ... }` blocks cover all protected routes — routes outside the block have no auth
- Check session configuration: cookie `secure` flag, `httpOnly`, signing key strength
- Verify JWT validation: algorithm, issuer, audience, expiry claims

### CONFIG
- Check `application.conf` / `application.yaml` (HOCON) for hardcoded secrets — verify `${ENV_VAR}` substitution
- Verify `ktor.deployment` does not expose debug settings in production
- Check `development` flag in `application.conf` — must be `false` in production (enables auto-reload)

### DATA
- Check `call.respond()` payloads — verify `@Serializable` data classes do not include internal fields
- Verify error handlers do not expose stack traces or internal exception details

### ACL
- Verify route-level authorization checks within `authenticate` blocks — authentication alone is not authorization
- Check for routes accidentally placed outside `authenticate` blocks

---

## 25. Firebase

### AUTH
- Verify Firebase Auth token validation on server-side (Cloud Functions, backend) — client-side `onAuthStateChanged` is not sufficient
- Check custom claims for privilege escalation — verify claims are set server-side only
- Verify email verification is required before granting access to sensitive operations

### ACL
- **Firestore rules:** Verify `rules_version = '2'` and every collection has explicit read/write rules — default `allow read, write: if false;` or `if true;` must not be present
- **RTDB rules:** Check `.read` and `.write` rules on every node — verify `auth != null` is not the only check for sensitive data
- **Storage rules:** Verify upload rules restrict file types and sizes — check for `allow write: if true;` on any path
- Verify rules enforce record-level ownership — not just "is authenticated" but "is the owner of this document"
- Check for `get()` / `exists()` calls in rules that could be abused for data enumeration

### CONFIG
- Firebase config (apiKey, projectId, etc.) is designed to be public — but verify API key restrictions are set in Google Cloud Console
- Check for Firestore/RTDB admin SDK usage in client-side code — admin SDK bypasses all security rules
- Verify Cloud Functions use `firebase-admin` (not client SDK) for server-side operations

### DATA
- Check Firestore queries for over-fetching — `collection().get()` retrieves all documents; verify queries filter and paginate
- Verify client-side listeners (`onSnapshot`) are scoped to user-owned data, not entire collections
- Check Cloud Functions HTTP triggers for response payload filtering — do not return full Firestore documents with internal fields
- Verify Firestore composite indexes do not enable unintended query patterns

### DEPS
- Check `firebase-functions` and `firebase-admin` versions for known vulnerabilities
- Verify Firebase project is not using deprecated auth methods (e.g., legacy token format)
