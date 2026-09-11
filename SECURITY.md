# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories for this repository. Do not include credentials, browser data, private screenshots, or account identifiers in a public issue.

## Credential handling

- The project does not need a separate AI API key and its scripts do not send screenshots to an AI service.
- Never commit `.env` files, Edge profiles, cookies, screenshots containing private content, session files, or generated capture directories.
- Treat the complete collection folder and `REPORT.md` as potentially sensitive because previews, descriptions, target URLs, and account labels may appear in them.
- Use a dedicated Windows VM and Edge profile when stronger isolation is needed.
- Stop automation when a site displays a CAPTCHA, account checkpoint, consent change, or security prompt.
- Prefer a tight player-region capture for `capture-video`. Full-desktop recording can retain notifications or unrelated private content and therefore requires an explicit flag.
- Visible screen recording is allowed only for content the user is authorized to view and retain. Do not use it to work around DRM, protected black frames, account restrictions, or platform security controls.

The project does not require or attempt to read browser cookies, saved passwords, or profile files. Session commands accept only screenshots inside their own run directory, and workflows cannot define arbitrary shell commands.
