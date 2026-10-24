# V1 changes from the HomeGuard design

Reference: `docs/design/homeguard/`. Visual language (tokens, type, icons, component style) is unchanged. Plan wins over the design (CLAUDE.md). Summary also in plan section 9.

## Wording and meaning

| # | Design | V1 | Why |
|---|--------|----|-----|
| 1 (D4) | Level "Up to date" (green shield with check) | Label **No known vulnerabilities**. Never "safe" or "up to date". | NVD data cannot prove safety. |
| 2 (D4) | Level "Not checked" | Label **Not tracked**, with a one-line reason and a next step. | Honest status; says why. |
| 3 (D4) | Headline "Safe, with updates waiting" | **Some updates are waiting** | Same. |
| 4 (D4) | Headline "No known problems on your devices" | Kept, plus a caption under the summary: "No known vulnerabilities only means nothing is known yet. It does not mean a device is safe." Adds "N devices can't be fully checked" when it applies. | Prevents a false sense of safety. |
| 5 (D11) | CVE titles rewritten in plain words | Title is "Security problem in <product>", then the first two sentences of the NVD summary. Full text behind "Full details on NVD" (new tab, `rel="noopener"`). | No hand-written copy per CVE. |
| 6 (D7) | n/a | Device with some parts checked: status can be No known vulnerabilities, with "N parts not checked". | Show gaps, do not hide them. |
| 7 | "Good news: this version has no known vulnerabilities. We'll let you know if that changes." | "Nothing is known for this version as of the last check. That is not a promise it is safe: new problems are found all the time, so we check again every day." | No "good news", no alerts in V1. |
| 8 | "Scanner" in nav and "Vulnerability scanner" tab | **Settings > Checks**. "Check all now" replaces "Scan now". | Home users do not scan networks in V1. |

## Structure and scope

| # | Design | V1 | Why |
|---|--------|----|-----|
| 9 (D9) | Add device: live Result card shows the outcome, including CVE count | Result card shows name, product, room and version, and "We'll check this after you save." No CVE count. Badge is "Not checked yet". For "Other" it shows **Not tracked** and "We don't have public security data for this device yet." | Checks run in the worker after save, not in the request. |
| 10 (D15) | Plan row: "PC with an SBOM file" as a fifth device type | Not a type. The "Software on this device" card (upload, help, parts list) appears on any device's page. | An SBOM is a way of giving data, not a kind of device. |
| 11 (D16) | n/a | A new upload replaces only SBOM parts; the manual product stays. | No data loss. |
| 12 | Scan my network, IP, found devices, scan depth, ports | Removed | Non-goal. |
| 13 (D3) | Notifications nav item, per-device alert switch | Removed | Non-goal. |
| 14 | Household and users, roles, invites | Settings > Account (change password) | Per-user in V1. |
| 15 (D14) | Passkey button, "Keep me signed in" | Removed | Later. |
| 16 (D13) | "Forgot password?" | Removed. Reset by host command. | No email in V1. |
| 17 | "Create a household" link | "Create an account" | Per-user in V1. |
| 18 | Pause scanner, schedule and key editing | Read-only facts, "Set in .env" | No secrets in the database (D12). |
| 19 | Version arrow `v3.1.0 -> 3.1.2` always | Arrow only when a fixed version is known | No "latest version" source. |
| 20 | Vulnerabilities list, CVE detail | New screens built from CveItem, Table, FactList. Open/Ignored filter. Ignore needs a reason. | Not in the design. |
| 21 | Dashboard and Devices pages | One page, "My home" | As in the design. |
| 22 (Q9) | No "Vulnerabilities" nav item | Sidebar and top bar have **Vulnerabilities** (route `/vulnerabilities`). | P7-4 needs a route; this is the simplest way to reach it. |
| 23 (Q4) | Sign-up asks for a name | Sign-up asks only for email and password. The account name is the part of the email before the @ (the server still limits names to 80 characters). | Fewer fields for a home user; matches P1-1. |
| 24 (Q8) | Tagline "Made for households, not security teams." | "Plain answers about your devices, not a security console." | Accounts are per person (D1), not households. |
| 25 (Q7) | SBOM help: one line per system | Adds: scanning the whole disk can take a long time and may need an administrator or sudo. | `syft dir:/` scans everything. |
| 26 (Q10) | Product CVE cache 7 days (P8-2) | 24 hours. Recorded in `docs/architecture-v1.md` section 10. Revisit if NVD limits are hit. | Nightly rescan sees new CVEs. |

## Open design issue (needs frontend)

- **The "No known vulnerabilities" badge still uses a green shield with a check mark** (`RiskBadge` `safe`, also the score tint). A check mark reads as "all good". Change the icon for this level to a shield with a dash or a ring (no check), keep the label. Keep the color pair for now; revisit if testing shows it still reads as "safe".
- Result card: a catalogue product with no version shows "Not checked yet / We'll check this after you save", but the device will be Not tracked. Show Not tracked with "Add the version and we'll check it." when the version is empty.
