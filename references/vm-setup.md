# Dedicated Windows VM setup

Use this setup when the scraper should not take focus, pointer control, or keyboard input away from the host desktop.

The CLI must run inside the guest operating system. Running it on the host while merely displaying a VM window will not work because the PowerShell helper discovers and controls Edge processes on the same Windows instance.

## Recommended guest

- Windows 11 with a persistent virtual disk.
- Hyper-V, VMware, or VirtualBox with a normal graphical console.
- Microsoft Edge, Git, Node.js 20 or newer, and Codex or another image-capable code agent installed in the guest.
- A fixed display resolution such as 1920x1080 and 100% display scaling.
- A dedicated Edge profile signed in manually by the user.
- A shared output directory that does not expose the Edge profile, cookies, or credential stores.

Keep the VM identity, clock, locale, timezone, and network configuration stable. Repeatedly reverting browser state or presenting the account as a different device can trigger additional account verification.

## Interactive desktop requirement

The screenshot helper uses `CopyFromScreen`, and input is delivered to a foreground Edge window. The guest desktop must therefore remain unlocked and visibly rendered.

- Prefer the hypervisor console for unattended runs.
- Do not minimize or disconnect an RDP session during capture; Windows may stop rendering it or switch sessions.
- Avoid secure-desktop prompts, display resizing, sleep, and screen locking.
- Disable automatic sleep only inside the dedicated guest and according to the owner's security policy.

## Install

From PowerShell inside the guest:

```powershell
$skillDirectory = Join-Path $env:USERPROFILE ".agents\skills\windows-visual-image-scraper"
git clone https://github.com/arturhc/windows-visual-scraper.git $skillDirectory
npm ci --prefix $skillDirectory
node "$skillDirectory\scripts\image-scraper.mjs" doctor
```

No separate AI API key is needed. The agent running inside the guest inspects local screenshots with its existing model session; the bundled scripts never contact an AI service.

## First run

Start with a dry run:

```powershell
node "$skillDirectory\scripts\image-scraper.mjs" start `
  --preset generic-lightbox-gallery `
  --url "https://example.com/gallery" `
  --count 2 `
  --output "C:\ScraperOutput" `
  --dry-run
```

For the first live session, add `--pause-for-login` and `--confirm-live-ui`. Confirm that the agent can open the returned PNG, then observe its screenshot/action loop from the VM console before unattended use.

## Account boundaries

A VM isolates the host desktop; it does not make automated activity invisible to a website and does not guarantee account safety. Keep collection authorized and conservative. Stop when a site presents a CAPTCHA, checkpoint, rate-limit message, consent change, or account-security prompt. Do not modify the workflow to bypass those controls.
