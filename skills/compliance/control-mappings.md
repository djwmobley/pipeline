# Compliance Framework Control Mappings

Reference file mapping Pipeline's 45 CWEs (from 12 red team specialist domains) to compliance framework controls. Used by framework agents during `/pipeline:compliance` to produce mapping reports.

**Mapping tiers:**
- **Tier 1** — Official CWE crosswalks maintained by standards bodies (NIST, PCI SSC)
- **Tier 2** — Defensible inference based on control descriptions and NIST 800-53 chaining
- **Tier 3** — Limited to software-relevant control subsets only; most framework controls are organizational/procedural

**Disclaimer:** These mappings are for compliance preparation only. They are not a compliance assessment, audit evidence, or certification artifact. Verify all mappings with your compliance team.

---

## NIST SP 800-53 Rev 5 (FedRAMP)

**Tier:** 1 | **Mapping source:** Official MITRE/NIST CWE↔800-53 crosswalk
**Software-testable scope:** ~12-15% of total controls

### Access Control (AC)

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| AC-3 | CWE-862, CWE-863, CWE-639 | Access enforcement — verify authorization checks on all resources |
| AC-4 | CWE-200, CWE-359 | Information flow enforcement — prevent unauthorized data disclosure |
| AC-6 | CWE-862, CWE-863 | Least privilege — restrict access to minimum necessary |
| AC-6(5) | CWE-862 | Privileged accounts — separate admin from user functions |
| AC-6(9) | CWE-532 | Log use of privileged functions |
| AC-6(10) | CWE-863 | Prohibit non-privileged users from executing privileged functions |
| AC-7 | CWE-770 | Unsuccessful logon attempts — enforce lockout after threshold |
| AC-10 | CWE-770 | Concurrent session control — limit number of active sessions |
| AC-12 | CWE-613 | Session termination — end sessions after inactivity or conditions |
| AC-17(2) | CWE-319, CWE-311 | Remote access — protect confidentiality/integrity via encryption |

### Audit and Accountability (AU)

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| AU-2 | CWE-778 | Event logging — define auditable events |
| AU-3 | CWE-532 | Content of audit records — ensure records contain required fields |
| AU-9 | CWE-532, CWE-200 | Protection of audit information — prevent unauthorized access to logs |

### Configuration Management (CM)

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| CM-6 | CWE-16, CWE-1188 | Configuration settings — establish and enforce secure defaults |
| CM-7 | CWE-16, CWE-215 | Least functionality — disable unnecessary services and features |

### Identification and Authentication (IA)

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| IA-2 | CWE-287 | Identification and authentication — verify user identity |
| IA-5 | CWE-522, CWE-798 | Authenticator management — protect passwords, keys, tokens |
| IA-5(1) | CWE-521 | Password-based authentication — enforce complexity and rotation |
| IA-6 | CWE-522 | Authentication feedback — obscure feedback during authentication |
| IA-8 | CWE-287 | Identification and authentication (non-organizational users) |

### Risk Assessment (RA)

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| RA-5 | CWE-1104, CWE-829 | Vulnerability monitoring and scanning — identify and remediate vulnerabilities |

### System and Services Acquisition (SA)

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| SA-11 | CWE-89, CWE-78, CWE-79, CWE-352 | Developer testing and evaluation — security testing in SDLC |
| SA-11(1) | CWE-89, CWE-79, CWE-78, CWE-94 | Static code analysis |
| SA-15 | CWE-1104 | Development process, standards, and tools |

### System and Communications Protection (SC)

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| SC-4 | CWE-200, CWE-212 | Information in shared resources — prevent residual data exposure |
| SC-8 | CWE-319, CWE-311 | Transmission confidentiality and integrity — encrypt data in transit |
| SC-8(1) | CWE-319, CWE-295 | Cryptographic protection for transmission |
| SC-12 | CWE-321, CWE-326 | Cryptographic key establishment and management |
| SC-13 | CWE-327, CWE-328, CWE-326 | Cryptographic protection — use validated cryptographic modules |
| SC-17 | CWE-295 | Public key infrastructure certificates — validate certificates |
| SC-23 | CWE-384, CWE-613 | Session authenticity — protect session identifiers |
| SC-28 | CWE-311, CWE-312 | Protection of information at rest — encrypt stored data |

### System and Information Integrity (SI)

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| SI-2 | CWE-1104, CWE-829 | Flaw remediation — patch known vulnerabilities |
| SI-3 | CWE-94, CWE-434 | Malicious code protection — prevent code injection and uploads |
| SI-5 | CWE-1104 | Security alerts, advisories, and directives |
| SI-7 | CWE-434, CWE-59 | Software, firmware, and information integrity |
| SI-10 | CWE-89, CWE-78, CWE-79, CWE-94, CWE-90, CWE-1336 | Information input validation — sanitize all inputs |
| SI-11 | CWE-209, CWE-215 | Error handling — prevent sensitive information disclosure in errors |
| SI-15 | CWE-200, CWE-598 | Information output filtering — prevent unintended data disclosure |
| SI-16 | CWE-400 | Memory protection — guard against resource exhaustion |

---

## PCI DSS 4.0

**Tier:** 1 | **Mapping source:** PCI SSC guidance, Requirement 6 explicitly references CWE
**Software-testable scope:** ~20-25% of total requirements

### Requirement 2 — Apply Secure Configurations

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| 2.2.6 | CWE-16, CWE-1188 | System security parameters configured to prevent misuse |
| 2.2.7 | CWE-319, CWE-311 | All non-console administrative access encrypted |

### Requirement 3 — Protect Stored Account Data

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| 3.5.1 | CWE-311, CWE-326 | Primary account number (PAN) secured with strong cryptography |
| 3.6.1 | CWE-321, CWE-326 | Cryptographic key management procedures |

### Requirement 4 — Protect Cardholder Data with Strong Cryptography During Transmission

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| 4.2.1 | CWE-319, CWE-295 | Strong cryptography for cardholder data transmission over open networks |
| 4.2.1.1 | CWE-295 | Trusted certificates for transmission |

### Requirement 6 — Develop and Maintain Secure Systems and Software

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| 6.2.1 | CWE-1104, CWE-829 | Bespoke and custom software developed securely |
| 6.2.2 | CWE-89, CWE-79, CWE-78, CWE-352 | Software development personnel trained in secure coding |
| 6.2.3 | CWE-89, CWE-79, CWE-78, CWE-94, CWE-862, CWE-863 | Bespoke and custom software reviewed prior to release |
| 6.2.4 | CWE-89, CWE-78, CWE-79, CWE-352, CWE-862, CWE-22, CWE-434 | Common software attacks addressed in development — injection, XSS, CSRF, access control, path traversal, uploads |
| 6.3.1 | CWE-1104, CWE-829 | Security vulnerabilities identified and managed — known CVEs in dependencies |
| 6.3.2 | CWE-1104 | Inventory of bespoke and custom software and third-party components |
| 6.3.3 | CWE-1104 | Software components patched for known vulnerabilities |
| 6.4.1 | CWE-79, CWE-87 | Public-facing web applications protected against attacks (WAF or code review) |
| 6.4.2 | CWE-79 | Public-facing web applications reviewed for new vulnerabilities |
| 6.5.1 | CWE-16, CWE-1188 | Change management for all system components |
| 6.5.4 | CWE-862, CWE-863 | Roles and functions segregated in development/test/production |
| 6.5.5 | CWE-200, CWE-532 | Live PANs not used in test or development |
| 6.5.6 | CWE-200, CWE-532 | Test data and accounts removed before production |

### Requirement 7 — Restrict Access to System Components and Cardholder Data by Business Need to Know

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| 7.2.1 | CWE-862, CWE-863 | Access control model defined and includes all components |
| 7.2.2 | CWE-862, CWE-639 | Access assigned based on job classification and function |
| 7.2.5 | CWE-862, CWE-863 | Access rights assigned by authorized personnel, restrict to least privilege |

### Requirement 8 — Identify Users and Authenticate Access

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| 8.2.1 | CWE-287 | All users assigned unique ID before accessing system components |
| 8.3.1 | CWE-287, CWE-798 | All user access authenticated using at least one factor |
| 8.3.4 | CWE-770 | Invalid authentication attempts limited (lockout) |
| 8.3.6 | CWE-521, CWE-522 | Minimum password complexity enforced |
| 8.3.9 | CWE-384, CWE-613 | Session management — unique session IDs, timeout after inactivity |
| 8.6.1 | CWE-798 | System or application accounts managed based on least privilege |

### Requirement 10 — Log and Monitor All Access

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| 10.2.1 | CWE-778 | Audit logs enabled and active for all system components |
| 10.2.1.2 | CWE-862 | Audit logs capture all actions by privileged users |
| 10.2.1.4 | CWE-287, CWE-770 | Audit logs capture invalid logical access attempts |

### Requirement 11 — Test Security of Systems and Networks Regularly

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| 11.3.1 | CWE-89, CWE-79, CWE-78, CWE-352 | Internal vulnerability scans performed quarterly |
| 11.3.2 | CWE-89, CWE-79, CWE-78 | External vulnerability scans performed quarterly |
| 11.4.1 | CWE-89, CWE-79, CWE-78, CWE-862 | Penetration testing performed annually |

---

## ISO/IEC 27001:2022 Annex A (via ISO 27002:2022)

**Tier:** 2 | **Mapping source:** Inference from ISO 27002 control descriptions
**Software-testable scope:** ~8-10% of total controls

### A.5 — Organizational Controls (limited software relevance)

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| A.5.14 | CWE-319, CWE-311 | Information transfer — protect data during transmission |
| A.5.17 | CWE-287, CWE-522 | Authentication information — manage credentials securely |
| A.5.33 | CWE-200, CWE-359 | Protection of records — prevent unauthorized disclosure |
| A.5.34 | CWE-200, CWE-359 | Privacy and protection of personal information |

### A.7 — Physical Controls

_All A.7 controls are OUTSIDE_AUTOMATED_SCOPE — they address physical security, not software._

### A.8 — Technological Controls (primary software relevance)

| Control | CWE Mappings | Description |
|---------|-------------|-------------|
| A.8.2 | CWE-862, CWE-863, CWE-639 | Privileged access rights — restrict and control privileged access |
| A.8.3 | CWE-862, CWE-863 | Information access restriction — enforce access based on policy |
| A.8.4 | CWE-89, CWE-78, CWE-94 | Access to source code — restrict and audit source code access |
| A.8.5 | CWE-287, CWE-384, CWE-613 | Secure authentication — implement strong authentication mechanisms |
| A.8.7 | CWE-94, CWE-434, CWE-829 | Protection against malware — prevent malicious code execution |
| A.8.9 | CWE-16, CWE-1188 | Configuration management — establish secure baselines |
| A.8.10 | CWE-200, CWE-532 | Information deletion — remove data when no longer needed |
| A.8.11 | CWE-200, CWE-532, CWE-598 | Data masking — protect sensitive data in non-production environments |
| A.8.12 | CWE-200, CWE-359 | Data leakage prevention — detect and prevent unauthorized data disclosure |
| A.8.15 | CWE-778 | Logging — record events for security monitoring |
| A.8.20 | CWE-319, CWE-295, CWE-311 | Network security — protect information in transit |
| A.8.24 | CWE-327, CWE-326, CWE-321 | Use of cryptography — implement appropriate cryptographic controls |
| A.8.25 | CWE-89, CWE-79, CWE-78, CWE-94, CWE-352 | Secure development lifecycle — build security into SDLC |
| A.8.26 | CWE-89, CWE-79, CWE-78, CWE-862, CWE-434 | Application security requirements — define and enforce security in applications |
| A.8.27 | CWE-16, CWE-1188, CWE-209 | Secure system architecture and engineering principles |
| A.8.28 | CWE-89, CWE-79, CWE-78, CWE-352, CWE-94, CWE-1336 | Secure coding — follow secure coding practices |
| A.8.29 | CWE-89, CWE-79, CWE-862 | Security testing in development and acceptance — test for vulnerabilities |
| A.8.31 | CWE-16, CWE-1188 | Separation of development, test, and production environments |
| A.8.33 | CWE-200, CWE-532 | Test information — protect test data from unauthorized access |

---

## NIST Cybersecurity Framework 2.0

**Tier:** 2 | **Mapping source:** CSF↔800-53 informative references (CWE → 800-53 → CSF chain)
**Software-testable scope:** ~10-12% of subcategories

### Protect (PR)

| Subcategory | CWE Mappings | Description | 800-53 Chain |
|-------------|-------------|-------------|--------------|
| PR.AA-01 | CWE-287, CWE-522, CWE-798 | Identities and credentials are managed | IA-2, IA-5 |
| PR.AA-02 | CWE-287, CWE-384 | Identities are proofed and authenticated | IA-2, IA-8 |
| PR.AA-03 | CWE-862, CWE-863, CWE-639 | Access permissions and authorizations are managed | AC-3, AC-6 |
| PR.AA-05 | CWE-770 | Account access is limited and managed | AC-7, AC-10 |
| PR.DS-01 | CWE-311, CWE-312 | Data at rest is protected | SC-28 |
| PR.DS-02 | CWE-319, CWE-295, CWE-311 | Data in transit is protected | SC-8 |
| PR.DS-10 | CWE-200, CWE-532, CWE-598 | Data confidentiality is protected | AC-4, SC-4 |
| PR.PS-01 | CWE-16, CWE-1188, CWE-215 | Configuration management is applied | CM-6, CM-7 |
| PR.PS-06 | CWE-89, CWE-79, CWE-78, CWE-352 | Secure software development practices are employed | SA-11 |

### Detect (DE)

| Subcategory | CWE Mappings | Description | 800-53 Chain |
|-------------|-------------|-------------|--------------|
| DE.CM-01 | CWE-778 | Networks and environments are monitored | AU-2 |
| DE.CM-06 | CWE-434, CWE-94 | External service provider activities and services are monitored | SI-3, SI-7 |
| DE.CM-09 | CWE-1104, CWE-829 | Computing hardware and software are monitored | RA-5, SI-2 |

### Identify (ID)

| Subcategory | CWE Mappings | Description | 800-53 Chain |
|-------------|-------------|-------------|--------------|
| ID.AM-08 | CWE-1104 | Assets are managed throughout their lifecycle including supply chain | RA-5 |
| ID.RA-01 | CWE-1104, CWE-829 | Vulnerabilities in assets are identified, validated, and recorded | RA-5 |

### Respond (RS)

| Subcategory | CWE Mappings | Description | 800-53 Chain |
|-------------|-------------|-------------|--------------|
| RS.MI-01 | CWE-1104 | Incidents are contained | SI-2 |
| RS.MI-02 | CWE-1104, CWE-829 | Incidents are eradicated | SI-2, SI-5 |

---

## SOC 2 Trust Services Criteria

**Tier:** 3 | **Mapping source:** Limited inference — TSC are principle-based, not prescriptive
**Software-testable scope:** ~5-8% of criteria

_SOC 2 criteria are organizational and principle-based. Only CC6 (Logical Access) and CC7 (System Operations) have limited software-testable aspects. Most SOC 2 evidence comes from policy documents, access review logs, and infrastructure configuration — not source code analysis._

### CC6 — Logical and Physical Access Controls (limited code relevance)

| Criterion | CWE Mappings | Description |
|-----------|-------------|-------------|
| CC6.1 | CWE-862, CWE-863, CWE-639, CWE-287 | Logical access security software, infrastructure, and architectures restrict access to authorized users |
| CC6.2 | CWE-287, CWE-522, CWE-798 | Credentials for infrastructure and software are created, managed, and distributed |
| CC6.3 | CWE-862, CWE-863 | Authorization is granted based on job responsibilities and need-to-know |
| CC6.6 | CWE-319, CWE-295, CWE-311 | System boundaries are protected — encrypt data in transit, validate endpoints |
| CC6.7 | CWE-319, CWE-200, CWE-598 | Information transmitted or received is protected — restrict data leakage channels |

### CC7 — System Operations (limited code relevance)

| Criterion | CWE Mappings | Description |
|-----------|-------------|-------------|
| CC7.1 | CWE-778, CWE-1104 | Detection and monitoring procedures implemented for security events |
| CC7.2 | CWE-209, CWE-532 | Anomalies are identified and evaluated — error handling does not leak sensitive information |

_Note: CC1-CC5 (Control Environment, Communication, Risk Assessment, Monitoring, Control Activities), CC8 (Change Management), and CC9 (Risk Mitigation) are entirely organizational/procedural and outside the scope of automated code analysis._

---

## GDPR (General Data Protection Regulation)

**Tier:** 3 | **Mapping source:** Limited inference — legal framework, not technical standard
**Software-testable scope:** ~3-5% of articles

_GDPR is a legal framework governing data protection rights. Most obligations are organizational (data controller/processor agreements, DPIAs, breach notification, DPO appointment). Only Articles 25 and 32 have aspects directly testable through code analysis._

### Article 25 — Data Protection by Design and by Default

| Aspect | CWE Mappings | Description |
|--------|-------------|-------------|
| 25(1) — Technical measures | CWE-311, CWE-327, CWE-200 | Implement appropriate technical measures (encryption, pseudonymization) to protect personal data |
| 25(2) — Data minimization by default | CWE-200, CWE-598, CWE-359, CWE-532 | By default, only personal data necessary for each specific purpose is processed and not made accessible to an indefinite number of persons |

### Article 32 — Security of Processing

| Aspect | CWE Mappings | Description |
|--------|-------------|-------------|
| 32(1)(a) — Pseudonymization and encryption | CWE-311, CWE-327, CWE-326, CWE-321 | Encrypt personal data at rest and in transit |
| 32(1)(b) — Confidentiality and integrity | CWE-89, CWE-79, CWE-862, CWE-287, CWE-319 | Ensure ongoing confidentiality, integrity, and availability of processing systems |
| 32(1)(d) — Testing and evaluating | CWE-89, CWE-79, CWE-78, CWE-352 | Regularly test, assess, and evaluate effectiveness of technical measures |

### Article 33 — Notification of a Personal Data Breach (limited)

| Aspect | CWE Mappings | Description |
|--------|-------------|-------------|
| 33 — Breach detection capability | CWE-778, CWE-532 | Ability to detect breaches — logging and monitoring must be in place to identify unauthorized access |

_Note: Articles 5-24, 26-31, 34-99 cover legal obligations (consent, rights of data subjects, cross-border transfers, supervisory authorities) that are outside the scope of automated code analysis._

---

## HIPAA Security Rule (45 CFR Part 164)

**Tier:** 3 | **Mapping source:** Limited inference — regulatory framework, not technical standard
**Software-testable scope:** ~5-8% of standards

_HIPAA's Security Rule has three safeguard categories: Administrative (§164.308), Physical (§164.310), and Technical (§164.312). Only Technical Safeguards have aspects directly testable through code analysis. Administrative and Physical Safeguards require organizational and infrastructure assessment._

### §164.312 — Technical Safeguards

| Standard | CWE Mappings | Description |
|----------|-------------|-------------|
| 164.312(a)(1) — Access control | CWE-862, CWE-863, CWE-639, CWE-287 | Implement technical policies and procedures for systems maintaining ePHI to allow access only to authorized persons |
| 164.312(a)(2)(i) — Unique user identification | CWE-287 | Assign unique name/number for identifying and tracking user identity |
| 164.312(a)(2)(iii) — Automatic logoff | CWE-613 | Implement electronic procedures that terminate a session after a period of inactivity |
| 164.312(a)(2)(iv) — Encryption and decryption | CWE-311, CWE-326, CWE-327 | Implement mechanism to encrypt and decrypt ePHI |
| 164.312(b) — Audit controls | CWE-778, CWE-532 | Implement hardware, software, and procedural mechanisms to record and examine access to ePHI |
| 164.312(c)(1) — Integrity controls | CWE-434, CWE-94, CWE-89 | Implement security measures to ensure ePHI is not improperly altered or destroyed |
| 164.312(d) — Person or entity authentication | CWE-287, CWE-522, CWE-798 | Implement procedures to verify a person or entity seeking access to ePHI is the one claimed |
| 164.312(e)(1) — Transmission security | CWE-319, CWE-295, CWE-311 | Implement technical security measures to guard against unauthorized access to ePHI during electronic transmission |
| 164.312(e)(2)(i) — Integrity controls (transmission) | CWE-319 | Ensure electronically transmitted ePHI is not improperly modified without detection |
| 164.312(e)(2)(ii) — Encryption (transmission) | CWE-319, CWE-326 | Encrypt ePHI whenever appropriate |

_Note: §164.308 (Administrative Safeguards — risk analysis, workforce training, contingency planning, business associate agreements) and §164.310 (Physical Safeguards — facility access, workstation security, device controls) are entirely outside the scope of automated code analysis._

---

## CWE Cross-Reference Index

Quick lookup: which frameworks map to each CWE used by Pipeline's red team specialists.

| CWE | Name | Frameworks |
|-----|------|------------|
| CWE-16 | Configuration | 800-53 CM-6/CM-7, PCI 2.2.6/6.5.1, ISO A.8.9/A.8.27/A.8.31, CSF PR.PS-01 |
| CWE-22 | Path Traversal | 800-53 (via SI-10), PCI 6.2.4, ISO A.8.26 |
| CWE-59 | Symlink Following | 800-53 SI-7 |
| CWE-78 | OS Command Injection | 800-53 SI-10/SA-11, PCI 6.2.3/6.2.4/11.3/11.4, ISO A.8.25-A.8.29, CSF PR.PS-06, GDPR 32(1)(b/d) |
| CWE-79 | Cross-Site Scripting | 800-53 SI-10/SA-11, PCI 6.2.3/6.2.4/6.4.1/6.4.2/11.3/11.4, ISO A.8.25-A.8.29, CSF PR.PS-06, GDPR 32(1)(b/d) |
| CWE-80 | Basic XSS | (same as CWE-79) |
| CWE-87 | Alternate XSS Syntax | PCI 6.4.1 |
| CWE-89 | SQL Injection | 800-53 SI-10/SA-11, PCI 6.2.2/6.2.3/6.2.4/11.3/11.4, ISO A.8.4/A.8.25-A.8.29, CSF PR.PS-06, GDPR 32(1)(b/d), HIPAA 164.312(c)(1) |
| CWE-90 | LDAP Injection | 800-53 SI-10 |
| CWE-94 | Code Injection | 800-53 SI-3/SI-10/SA-11, ISO A.8.7/A.8.25/A.8.28, CSF DE.CM-06, HIPAA 164.312(c)(1) |
| CWE-200 | Sensitive Info Exposure | 800-53 AC-4/SC-4/SI-15, PCI 6.5.5/6.5.6, ISO A.8.10-A.8.12/A.8.33, CSF PR.DS-10, GDPR 25(1)/25(2), SOC2 CC6.7 |
| CWE-209 | Error Message Info Leak | 800-53 SI-11, ISO A.8.27, SOC2 CC7.2 |
| CWE-215 | Debug Info Leak | 800-53 CM-7/SI-11, CSF PR.PS-01 |
| CWE-287 | Improper Authentication | 800-53 IA-2/IA-8, PCI 8.2.1/8.3.1/10.2.1.4, ISO A.8.5, CSF PR.AA-01/PR.AA-02, GDPR 32(1)(b), HIPAA 164.312(a)(1)/164.312(a)(2)(i)/164.312(d), SOC2 CC6.1/CC6.2 |
| CWE-295 | Improper Certificate Validation | 800-53 SC-8(1)/SC-17, PCI 4.2.1/4.2.1.1, ISO A.8.20, CSF PR.DS-02, HIPAA 164.312(e)(1), SOC2 CC6.6 |
| CWE-311 | Missing Encryption of Sensitive Data | 800-53 AC-17(2)/SC-8/SC-28, PCI 2.2.7/3.5.1/4.2.1, ISO A.8.20, CSF PR.DS-01/PR.DS-02, GDPR 25(1)/32(1)(a/b), HIPAA 164.312(a)(2)(iv)/164.312(e)(1), SOC2 CC6.6 |
| CWE-319 | Cleartext Transmission | 800-53 AC-17(2)/SC-8, PCI 2.2.7/4.2.1, ISO A.5.14/A.8.20, CSF PR.DS-02, GDPR 32(1)(b), HIPAA 164.312(e), SOC2 CC6.6/CC6.7 |
| CWE-321 | Hard-coded Crypto Key | 800-53 SC-12, PCI 3.6.1, ISO A.8.24, GDPR 32(1)(a) |
| CWE-326 | Inadequate Encryption Strength | 800-53 SC-12/SC-13, PCI 3.5.1/3.6.1, ISO A.8.24, GDPR 32(1)(a), HIPAA 164.312(a)(2)(iv)/164.312(e)(2)(ii) |
| CWE-327 | Broken Crypto Algorithm | 800-53 SC-13, ISO A.8.24, GDPR 32(1)(a), HIPAA 164.312(a)(2)(iv) |
| CWE-328 | Weak Hash | 800-53 SC-13 |
| CWE-330 | Insufficient Randomness | 800-53 SC-13 |
| CWE-352 | Cross-Site Request Forgery | 800-53 SA-11/SI-10, PCI 6.2.2/6.2.4/11.3, ISO A.8.25/A.8.28, CSF PR.PS-06, GDPR 32(1)(d) |
| CWE-359 | Privacy Violation | 800-53 AC-4, ISO A.5.33/A.5.34/A.8.12, GDPR 25(2) |
| CWE-377 | Insecure Temp File | 800-53 (via SI-7) |
| CWE-384 | Session Fixation | 800-53 SC-23, PCI 8.3.9, ISO A.8.5, CSF PR.AA-02 |
| CWE-400 | Uncontrolled Resource Consumption | 800-53 SI-16 |
| CWE-434 | Unrestricted File Upload | 800-53 SI-3/SI-7/SI-10, PCI 6.2.4, ISO A.8.7/A.8.26, CSF DE.CM-06, HIPAA 164.312(c)(1) |
| CWE-522 | Insufficiently Protected Credentials | 800-53 IA-5/IA-6, ISO A.5.17, HIPAA 164.312(d), SOC2 CC6.2 |
| CWE-532 | Sensitive Info in Logs | 800-53 AU-3/AU-9, PCI 6.5.5/6.5.6, ISO A.8.10/A.8.11/A.8.33, CSF PR.DS-10, GDPR 25(2), HIPAA 164.312(b), SOC2 CC7.2 |
| CWE-598 | Sensitive Info in GET | 800-53 SI-15, ISO A.8.11, CSF PR.DS-10, GDPR 25(2), SOC2 CC6.7 |
| CWE-613 | Insufficient Session Expiration | 800-53 AC-12/SC-23, PCI 8.3.9, ISO A.8.5, HIPAA 164.312(a)(2)(iii) |
| CWE-639 | IDOR | 800-53 AC-3, PCI 7.2.2, ISO A.8.2, CSF PR.AA-03, HIPAA 164.312(a)(1), SOC2 CC6.1 |
| CWE-770 | Resource Exhaustion | 800-53 AC-7/AC-10, PCI 8.3.4/10.2.1.4, CSF PR.AA-05 |
| CWE-778 | Insufficient Logging | 800-53 AU-2, ISO A.8.15, CSF DE.CM-01, GDPR 33, HIPAA 164.312(b), SOC2 CC7.1 |
| CWE-798 | Hard-coded Credentials | 800-53 IA-5, PCI 8.3.1/8.6.1, HIPAA 164.312(d), SOC2 CC6.2 |
| CWE-829 | Untrusted Functionality | 800-53 RA-5/SA-15/SI-2, PCI 6.2.1/6.3.1, CSF ID.RA-01/DE.CM-09/RS.MI-02 |
| CWE-862 | Missing Authorization | 800-53 AC-3/AC-6, PCI 6.2.3/6.2.4/7.2.1/7.2.5/10.2.1.2/11.4, ISO A.8.2/A.8.3/A.8.26/A.8.29, CSF PR.AA-03, GDPR 32(1)(b), HIPAA 164.312(a)(1), SOC2 CC6.1/CC6.3 |
| CWE-863 | Incorrect Authorization | 800-53 AC-3/AC-6/AC-6(10), PCI 6.2.3/6.5.4/7.2.1/7.2.5, ISO A.8.2/A.8.3, CSF PR.AA-03, SOC2 CC6.1/CC6.3 |
| CWE-1104 | Unmaintained Components | 800-53 RA-5/SA-15/SI-2/SI-5, PCI 6.2.1/6.3.1/6.3.2/6.3.3, CSF ID.AM-08/ID.RA-01/DE.CM-09/RS.MI-01/RS.MI-02, SOC2 CC7.1 |
| CWE-1188 | Insecure Default Init | 800-53 CM-6, PCI 2.2.6/6.5.1, ISO A.8.9/A.8.27/A.8.31, CSF PR.PS-01 |
| CWE-1333 | ReDoS | 800-53 (via SI-16) |
| CWE-1336 | Template Injection | 800-53 SI-10, ISO A.8.28 |
