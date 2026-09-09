# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories for this repository. Do not include API keys, browser data, private screenshots, or account identifiers in a public issue.

## Credential handling

- Supply `OPENAI_API_KEY` only through the process environment.
- Never commit `.env` files, Edge profiles, cookies, screenshots containing private content, or generated capture directories.
- Use a dedicated Windows VM and Edge profile when stronger isolation is needed.
- Stop automation when a site displays a CAPTCHA, account checkpoint, consent change, or security prompt.

The project does not require or attempt to read browser cookies, saved passwords, or profile files.
