# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅ Yes    |

## Reporting a Vulnerability

If you discover a security vulnerability in the TigerTag JavaScript SDK or the TigerTag protocol, **please do not open a public GitHub issue**.

Report it privately by email:

**tigertag@tigertag.io**

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Your suggested fix (optional)

We will acknowledge your report within 48 hours and aim to release a fix within 14 days depending on severity.

## Scope

This policy covers:
- The `tigertag` npm package (`src/` source)
- The TigerTag binary protocol parser and serializer
- The ECDSA-P256 signature verification logic
- The database sync mechanism (`src/db.js`)

Out of scope:
- The TigerTag cloud API (contact the manufacturer directly)
- Third-party NFC SDKs used alongside this library
- Chips already deployed in the field
