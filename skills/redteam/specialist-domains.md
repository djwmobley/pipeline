# Security Specialist Domains

Reference file defining the 12 specialist domains used in red team assessments.
Each domain focuses a specialist agent on a specific category of security concerns.

---

## 1. INJ — Injection

Injection flaws occur when untrusted data is sent to an interpreter as part of a command or query. An attacker's hostile data can trick the interpreter into executing unintended commands or accessing data without proper authorization. This domain covers all forms of injection across SQL, NoSQL, OS commands, LDAP, and template engines.

### CWE References

| CWE ID | Name |
|--------|------|
| CWE-89 | SQL Injection |
| CWE-78 | OS Command Injection |
| CWE-94 | Code Injection |
| CWE-90 | LDAP Injection |
| CWE-1336 | Template Injection |

### Checklist

1. SQL injection via string concatenation or raw query construction
2. NoSQL injection through unsanitized query operators or JSON payloads
3. OS command injection via exec, spawn, system, or shell invocations
4. LDAP injection through unsanitized filter construction
5. Server-side template injection in template engines (Jinja2, Handlebars, EJS, etc.)
6. ORM escape hatches that bypass parameterization (raw SQL methods, literal expressions)
7. Parameterized query enforcement across all database access paths
8. Stored procedure injection through dynamic SQL within procedures

---

## 2. AUTH — Authentication & Session Management

Authentication and session management flaws allow attackers to compromise passwords, keys, or session tokens, or to exploit implementation flaws to assume other users' identities. This domain covers the full authentication lifecycle from credential storage through session handling and token management.

### CWE References

| CWE ID | Name |
|--------|------|
| CWE-287 | Improper Authentication |
| CWE-384 | Session Fixation |
| CWE-613 | Insufficient Session Expiration |
| CWE-522 | Insufficiently Protected Credentials |
| CWE-798 | Hard-coded Credentials |

### Checklist

1. Password hashing algorithm strength (bcrypt/argon2 required; MD5/SHA1 flagged)
2. Session token entropy and generation method
3. Session fixation prevention on login (token regeneration after authentication)
4. Session expiration and renewal policies (idle timeout, absolute timeout)
5. Credential storage security (encrypted at rest, no plaintext)
6. Brute force protection (account lockout, rate limiting, CAPTCHA)
7. OAuth/OIDC misconfiguration (redirect URI validation, state parameter, PKCE)
8. JWT validation completeness (algorithm confusion, `none` algorithm, signature verification)
9. Remember-me token security (separate long-lived token, revocable)
10. Account enumeration via error messages or timing differences
11. Multi-factor authentication bypass paths

---

## 3. XSS — Cross-Site Scripting

Cross-site scripting flaws occur when an application includes untrusted data in web output without proper validation or escaping. XSS allows attackers to execute scripts in a victim's browser, hijacking sessions, defacing sites, or redirecting users. This domain covers reflected, stored, and DOM-based XSS vectors.

### CWE References

| CWE ID | Name |
|--------|------|
| CWE-79 | Cross-site Scripting (XSS) |
| CWE-80 | Basic XSS |
| CWE-87 | Alternate XSS Syntax |

### Checklist

1. Reflected XSS in URL parameters, headers, and other request inputs
2. Stored XSS in user-generated content (comments, profiles, messages)
3. DOM XSS via dangerous sinks (innerHTML, eval, setTimeout with strings)
4. Content Security Policy configuration and known bypass vectors
5. Sanitization library usage and coverage across all output contexts
6. Template engine auto-escaping configuration and raw output usage
7. SVG and image-based XSS vectors (inline SVG, onload handlers)
8. Event handler injection through attribute contexts
9. Rich text editor sanitization (allowlists vs blocklists, nested tag bypass)

---

## 4. CSRF — Cross-Site Request Forgery

Cross-site request forgery forces an authenticated user's browser to send a forged request to a vulnerable web application. The attacker exploits the trust that a site has in the user's browser. This domain covers all anti-CSRF mechanisms and their correct implementation.

### CWE References

| CWE ID | Name |
|--------|------|
| CWE-352 | Cross-Site Request Forgery (CSRF) |

### Checklist

1. CSRF token presence on all state-changing forms and requests
2. SameSite cookie attribute configuration (Strict or Lax)
3. Origin and Referer header validation on state-changing endpoints
4. State-changing operations exposed via GET requests (must be POST/PUT/DELETE)
5. CORS preflight configuration (allowed origins, methods, credentials)
6. Double-submit cookie pattern implementation correctness
7. Token scope: per-request tokens vs session-bound tokens
8. CSRF protection on login forms (login CSRF)

---

## 5. CRYPTO — Cryptography

Cryptographic failures occur when sensitive data is not properly protected through encryption, hashing, or secure random generation. Weak algorithms, hardcoded keys, and improper implementation can expose data even when encryption is present. This domain covers all aspects of cryptographic implementation and configuration.

### CWE References

| CWE ID | Name |
|--------|------|
| CWE-327 | Use of a Broken or Risky Cryptographic Algorithm |
| CWE-328 | Use of Weak Hash (Reversible One-Way Hash) |
| CWE-330 | Use of Insufficiently Random Values |
| CWE-321 | Use of Hard-coded Cryptographic Key |
| CWE-326 | Inadequate Encryption Strength |

### Checklist

1. Algorithm strength validation (AES-256 vs DES/3DES, RSA-2048+ vs RSA-1024)
2. Hardcoded encryption keys, secrets, or initialization vectors in source code
3. Random number generation method (crypto.randomBytes or equivalent vs Math.random)
4. TLS version and cipher suite configuration (TLS 1.2+ required)
5. Certificate validation implementation (no disabled verification)
6. Key derivation function usage (PBKDF2, scrypt, or argon2 with proper parameters)
7. Initialization vector reuse across encryption operations
8. Password hashing algorithm (argon2 or bcrypt only; no raw SHA/MD5)

---

## 6. CONFIG — Security Misconfiguration

Security misconfiguration is the most common vulnerability class. It results from insecure default configurations, incomplete configurations, open cloud storage, misconfigured HTTP headers, or verbose error messages. This domain covers deployment configuration, error handling, and security header enforcement.

### CWE References

| CWE ID | Name |
|--------|------|
| CWE-16 | Configuration |
| CWE-209 | Generation of Error Message Containing Sensitive Information |
| CWE-215 | Insertion of Sensitive Information Into Debugging Code |
| CWE-1188 | Insecure Default Initialization of Resource |

### Checklist

1. Debug mode enabled in production (DEBUG=true, development flags)
2. Default credentials present in configuration or code
3. Verbose error messages exposed to users (stack traces, internal paths)
4. Unnecessary features, endpoints, or services enabled in production
5. CORS permissiveness (wildcard origins with credentials, overly broad allowlists)
6. Security headers present and correct (HSTS, X-Frame-Options, X-Content-Type-Options, CSP)
7. Directory listing enabled on web servers
8. Stack traces or internal details in HTTP responses
9. Admin panel or management endpoints exposed without network restriction
10. Environment variable leakage in client-side bundles (API keys, secrets in NEXT_PUBLIC_ or VITE_ vars)

---

## 7. DEPS — Dependency & Supply Chain

Applications rely on hundreds of third-party packages, any of which can introduce vulnerabilities or malicious code. Supply chain attacks target the build and distribution pipeline rather than the application itself. This domain covers dependency health, known vulnerabilities, and supply chain integrity.

### CWE References

| CWE ID | Name |
|--------|------|
| CWE-1104 | Use of Unmaintained Third-Party Components |
| CWE-829 | Inclusion of Functionality from Untrusted Control Sphere |

### Checklist

0. **Live dependency audit** — Run the project's configured audit command (`commands.security_audit` from pipeline.yml) to query real-time vulnerability databases. Parse JSON output for CRITICAL and HIGH severity advisories. This provides ground truth that training data cannot.
1. Known CVEs in direct dependencies (via advisory databases)
2. Known CVEs in transitive dependencies (deep dependency tree)
3. Lockfile integrity (lockfile exists, matches manifest, committed to repo)
4. Typosquatting risk assessment (packages with names similar to popular libraries)
5. Postinstall scripts in dependencies (arbitrary code execution on install)
6. Version pinning strategy (pinned vs floating, caret vs tilde vs exact)
7. Abandoned or unmaintained packages (no updates in 2+ years, archived repos)
8. Dependency confusion risk (private package names that could collide with public registry)
9. Cross-reference audit output with source code — verify vulnerable packages are actually imported and used (transitive-only exposure is lower severity)

---

## 8. ACL — Access Control

Access control enforces policy so that users cannot act outside their intended permissions. Failures typically lead to unauthorized information disclosure, modification, or destruction of data, or performing business functions outside the user's privilege level. This domain covers authorization, object-level access, and path-based access controls.

### CWE References

| CWE ID | Name |
|--------|------|
| CWE-862 | Missing Authorization |
| CWE-863 | Incorrect Authorization |
| CWE-639 | Authorization Bypass Through User-Controlled Key (IDOR) |
| CWE-22 | Path Traversal |

### Checklist

1. Insecure Direct Object Reference (IDOR) via predictable or user-controlled resource IDs
2. Horizontal privilege escalation (accessing another user's resources at the same role level)
3. Vertical privilege escalation (performing admin actions as a regular user)
4. Missing authorization checks on API endpoints (authenticated but not authorized)
5. Path traversal in file operations (../ sequences, encoded variants)
6. Role-based access control enforcement consistency across all routes
7. Resource ownership validation before granting access
8. Admin-only endpoint protection (separate middleware, not just UI hiding)
9. Authorization enforcement after authentication (not just checking if user is logged in)

---

## 9. RATE — Rate Limiting & DoS

Rate limiting and denial-of-service protections prevent attackers from exhausting application resources or abusing functionality through automated requests. Without these controls, authentication can be brute-forced, APIs can be scraped, and application resources can be exhausted. This domain covers request throttling, resource limits, and algorithmic complexity.

### CWE References

| CWE ID | Name |
|--------|------|
| CWE-770 | Allocation of Resources Without Limits or Throttling |
| CWE-400 | Uncontrolled Resource Consumption |
| CWE-1333 | Inefficient Regular Expression Complexity (ReDoS) |

### Checklist

1. Rate limiting on authentication endpoints (login, password reset, MFA)
2. Rate limiting on general API endpoints (per-user, per-IP, or per-key)
3. Request body size limits enforced at the server/framework level
4. File upload size limits and concurrent upload restrictions
5. ReDoS vulnerability in regular expressions (catastrophic backtracking patterns)
6. Algorithmic complexity attacks (hash collision, quadratic sort behavior)
7. Database query limits enforced (pagination required, maximum result count)
8. WebSocket message rate limiting and connection limits
9. GraphQL query depth and complexity limits (nested queries, field explosion)
10. Resource cleanup for connection pools, file handles, and temporary files

---

## 10. DATA — Data Exposure

Data exposure occurs when applications inadvertently reveal sensitive information through logs, error messages, API responses, or insecure storage. Even when primary data stores are secured, information can leak through secondary channels. This domain covers all paths through which sensitive data can be unintentionally disclosed.

### CWE References

| CWE ID | Name |
|--------|------|
| CWE-200 | Exposure of Sensitive Information to an Unauthorized Actor |
| CWE-532 | Insertion of Sensitive Information into Log File |
| CWE-598 | Use of GET Request Method With Sensitive Query Strings |
| CWE-359 | Exposure of Private Personal Information to an Unauthorized Actor |

### Checklist

1. PII or sensitive data present in log output (passwords, tokens, SSNs)
2. Sensitive data transmitted in URL query strings (visible in logs, referer headers, browser history)
3. Overly verbose API responses returning full objects when a subset is sufficient
4. Sensitive data included in error messages or debug output
5. Cache-Control headers on pages containing sensitive data (no-store required)
6. Autocomplete attributes on password and sensitive input fields
7. Data at rest encryption for databases and file storage containing sensitive data
8. Data retention and deletion policies (right to erasure, automated cleanup)
9. Sensitive data stored in client-side storage (localStorage, sessionStorage, cookies)
10. API response filtering to prevent leakage of internal IDs, timestamps, or system metadata

---

## 11. FILE — File & Path Safety

File handling vulnerabilities allow attackers to read, write, or execute arbitrary files on the server. Unsafe file uploads, path traversal, and symlink attacks can lead to remote code execution or data exfiltration. This domain covers all file system interactions including uploads, downloads, and path construction.

### CWE References

| CWE ID | Name |
|--------|------|
| CWE-22 | Path Traversal |
| CWE-434 | Unrestricted Upload of File with Dangerous Type |
| CWE-59 | Improper Link Resolution Before File Access (Symlink) |
| CWE-377 | Insecure Temporary File |

### Checklist

1. Path traversal in file operations (../ sequences, URL-encoded and double-encoded variants)
2. Unrestricted file upload (missing type, size, and content validation)
3. Symlink following attacks (resolving symlinks before access checks)
4. Temporary file race conditions (predictable names, insecure permissions)
5. File permissions set on created files and directories (principle of least privilege)
6. Filename sanitization (null bytes, special characters, reserved names)
7. Upload directory located outside the webroot (no direct execution)
8. Content-type validation based on file content, not just extension
9. Zip slip vulnerability in archive extraction (paths escaping target directory)
10. File inclusion attacks (local file inclusion, remote file inclusion)

---

## 12. CERT — Certificate & Transport

Transport layer security protects data in transit between clients and servers. Misconfigured certificates, mixed content, and insecure protocol usage can expose sensitive data to interception. This domain covers TLS configuration, certificate validation, and secure transport enforcement.

### CWE References

| CWE ID | Name |
|--------|------|
| CWE-295 | Improper Certificate Validation |
| CWE-319 | Cleartext Transmission of Sensitive Information |
| CWE-311 | Missing Encryption of Sensitive Data |

### Checklist

1. Certificate pinning implementation for mobile applications
2. Mixed content detection (HTTP resources loaded on HTTPS pages)
3. HSTS configuration with appropriate max-age and preload eligibility
4. Insecure redirects that transmit sensitive data over HTTP before redirecting to HTTPS
5. TLS version enforcement (TLS 1.2 minimum, TLS 1.3 preferred)
6. Certificate validation disabled in application code (rejectUnauthorized: false, verify: false)
7. API calls made to HTTP endpoints instead of HTTPS
8. WebSocket transport security (wss:// required, ws:// flagged)
9. Cookie Secure flag set on all session and sensitive cookies
