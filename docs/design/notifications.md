# Email alerts: Settings > Notifications, landing pages and mail wording

Status: spec for NU-1 in `docs/backlog-notifications.md`. Owner: ux-designer. Build: frontend-engineer (screens), backend-engineer (mail text in the Rust builder).
Reference: `docs/design/homeguard/screens/06-settings-notifications*.png`. Visual language is unchanged (tokens, Figtree, icons, Card, Banner, Pill, Switch). Deviations are listed at the end and in `docs/design/v1-changes.md` (rows 27 to 33).

## 1. What the person needs to know

1. Will HomeGuard email me? (on or off, and to which address)
2. What will it email me about, and when?
3. Does it work? (test mail, last mail)
4. If it is quiet, what does that mean? Silence is not safety, so say it.

No tokens are new. Everything below uses existing tokens only: `surface-100` cards, `line`, `brand`/`brand-tint`, risk colors and their tints, `ink-muted`, `radius-lg` cards, `space-*`.

## 2. Settings > Notifications

Route `/settings/notifications`. Tab "Notifications" after Account and Checks (SubNav). Content column is the settings width (max 880). Cards stack with 24 px gap. The h1 "Settings" is already in the layout; the cards use `heading` (h2).

### Layout (desktop)

```
Settings
[Account] [Checks] [Notifications]
------------------------------------------------------------

+-- Card: Email alerts ---------------------------------------+
| Email alerts                              (state Pill)      |
| Email me about new problems                    [ switch ]   |
| <state line>                                                |
| <state message / buttons>                                   |
| ----------------------------------------------------------- |
| <last email line>                                           |
| [ Send a test email ]   <reason or result text>             |
+-------------------------------------------------------------+

+-- Card: What we email you ----------------------------------+
| Right away                                                  |
|   [Critical pill]  A new Critical problem on a device.      |
| Daily summary, 7 am                                         |
|   [Critical] [Vulnerable]  New problems, only when there    |
|                            are any.                         |
| Not emailed                                                 |
|   Update available, Low and Not tracked. Open My home to    |
|   see these.                                                |
| ----------------------------------------------------------- |
| We only email about new problems. No email does not mean    |
| a device is safe.                                           |
+-------------------------------------------------------------+

+-- Card: This is what an alert looks like -------------------+
| (plain-text mail sample, mono is NOT used: it is a sentence)|
+-------------------------------------------------------------+
```

Order matters: control first, promise second, sample last. The sample is the only part that can be skipped.

### Card 1: Email alerts

Components: `Card`, `Pill` (state), `Switch` inside a `.switch-row` (label left, switch right, row min height 44 px), `Button` (secondary, quiet), `Banner`, `Spinner`, `ErrorText`.

- Title: "Email alerts".
- Switch label: **Email me about new problems**. The label is a real `<label>` tied to the switch. The switch is a native checkbox with `role="switch"`.
- The state is a Pill with icon and text next to the title. Never color alone.

| State | Pill (icon + text) | Switch | State line | Extra |
|-------|--------------------|--------|-----------|-------|
| Loading | none; skeleton lines | disabled | none | Spinner with visually hidden "Loading email settings" |
| SMTP not configured, state OFF | info icon, "Not set up" (neutral `unknown` colors) | disabled, off | "Email alerts aren't set up on this HomeGuard yet. Ask the person who runs it." | Under it, quiet caption: "They can set this up in the .env file. The README has the steps." No link to secrets, no variable names in the UI. |
| Off | dash-circle icon, "Off" (neutral) | off | "Off. Turn it on and we'll send a link to confirm." | Address line: "Your address: you@example.com" |
| Turning on (request running) | Spinner, "Sending link" | disabled, `aria-busy` | "Sending a link to you@example.com..." | None |
| Confirm pending | clock icon, "Waiting for you" (`update` colors) | replaced by two buttons, see below | "We sent a link to you@example.com. Open it to turn on alerts." | Caption: "The link works for 48 hours. Alerts are not on until you open it." Buttons: "Send the link again" (secondary; disabled for 10 minutes with the text "You can ask again in 8 minutes." counting down by minute), "Cancel" (quiet; sets the state back to Off). Caption: "Nothing in the inbox? Look in your spam folder." |
| On | bell-check is NOT used. Use bell icon, "On" (`brand` colors, not the green `safe` pair) | on, enabled | "On. Sent to you@example.com." | Last-email line and test button become active |
| Turning off | Spinner | disabled | "Turning off..." | None |
| On, but SMTP stopped working | critical icon, "Can't send" (`critical`) | on, enabled (so the person can turn it off) | "Email alerts are on for you, but this HomeGuard can't send email right now. Ask the person who runs it to check the email settings." | `Banner critical` with the same sentence. Test button disabled with reason. |

Rules:
- "On" uses `brand`, never the `safe` green. "On" means mail will be sent, not that things are fine.
- Turning the switch on shows a request in progress and waits for the server. It does not flip optimistically. If the request fails, the switch stays off and the error shows (below).
- Turning off needs no confirmation dialog. It is reversible and the confirm mail returns easily. After success: "Email alerts are off." (status region).
- The switch's accessible name is the label; the state line is linked with `aria-describedby`; changes are announced through a `role="status"` region.

Last-email line (below a hairline inside the card, only when state is On, or Off after having been on):

| Case | Text |
|------|------|
| Never sent | "No email sent yet." |
| Sent | "Last email sent 2 hours ago." with the full date in a `title` and as `<time datetime>` |
| Failed | Critical icon + "Last email couldn't be sent. We'll try again with the next daily summary." (`critical` text color, role not alert on load, it is a status) |

Test mail:
- Button "Send a test email" (secondary, 44 px).
- Enabled only when state is On and SMTP works.
- Disabled reasons shown as text beside or below the button (not only a tooltip, because disabled buttons are not focusable):

| Why disabled | Text |
|--------------|------|
| Off or pending | "Turn on email alerts first." |
| SMTP not set up or broken | "Email isn't set up on this HomeGuard." |
| Rate limited (from API 429) | The API text: "Wait a few minutes before sending another test email." with info icon |

- While sending: button shows Spinner and "Sending..." and is disabled.
- Success (status region, info icon): "Sent to you@example.com. Check your inbox. It can take a minute."
- Failure: critical icon + "We couldn't send the test email. Try again in a minute."
- The success text stays until the next action. It never says "Working" or "All good".

Errors on turning on or off (inside the card, `ErrorText` with icon, `role="alert"`):

| Cause | Text |
|-------|------|
| SMTP not set up (API error) | "Email alerts aren't set up on this HomeGuard yet." |
| 429 on the confirm link | "Wait a few minutes before asking for another link." |
| Network or server | "We couldn't change your email settings. Try again in a minute." |
| Load failure of the whole card | `Banner critical`: "We couldn't load your email settings." with button "Try again" |

### Card 2: What we email you

This card is information, not a form. It replaces the design's per-level selects: there are no choices in V1, so no controls. Users can't misconfigure what does not exist.

- Title: "What we email you".
- Row "Right away": RiskBadge Critical, text "A new Critical problem on one of your devices." Sub-caption (caption style): "At most one of these an hour. Anything held back goes into the daily summary."
- Row "Daily summary, 7 am": RiskBadges Critical and Vulnerable, text "New Critical and Vulnerable problems, only on days when there are any."
- Row "Not emailed": text "Update available, Low and Not tracked. Open My home to see these." RiskBadges for Update available and Not tracked (icon + text) so the wording matches the rest of the app.
- Footer (always, `ink-muted` body, with an info icon): "We only email about new problems. No email does not mean a device is safe."
- The card shows in every state, including SMTP not configured, so the person understands what they would get.
- It does not mention push, weekly reports, quiet hours or per-device choices. Do not hint at them as "coming soon".
- The daily time follows the server's time zone. Text says "7 am" in the person's reading, but note for the engineer: this is the server time zone; the spec text stays "7 am".

### Card 3: This is what an alert looks like

- Title: "This is what an alert looks like". Caption: "Always the device's name, how bad it is and one thing to do."
- A mail-like box (`surface-0` fill, `line` border, `radius-md`) containing the sample subject (heading) and body text in Figtree (not mono) using this fixed sample:

```
Subject: Front door camera needs fixing now

Front door camera needs fixing now.
Critical: Security problem in Acme CamOS. Attackers are already using this problem.
Update to 3.1.2 to fix this.
```

- Marked as an example with a Pill "Example". Sample device name is clearly fake ("Front door camera"); the box has `aria-label="Example email"`.
- Hidden when the card stack would be long on phones? No, it stays; it is short.

### Mobile (390 px)

- SubNav scrolls sideways inside its row; tabs 44 px high; "Notifications" tab scrolls into view when current.
- Card padding drops to 16. Switch row stays one row (label wraps, switch fixed 44 x 26 on the right).
- Pill moves under the title if it does not fit.
- Pending buttons and "Send a test email" are full width, stacked, 44 px, 8 px gap.
- Disabled-reason text sits under the button, not beside it.
- Mail sample box wraps; no horizontal scroll anywhere. Check at 320 px.

### Keyboard and screen reader

- Tab order: tabs, switch, pending buttons, test button, links. Focus ring `2px solid brand`, offset 2.
- State changes (on, off, link sent, test sent, errors) go to one `role="status"` region; errors use `role="alert"`.
- Pill text is real text. Icons are `aria-hidden`.
- Relative times have an absolute `title` and `<time>`.
- Contrast: every text/background pair is an existing token pair; the `update`/`critical` text on tint pairs already pass AA. Check `ink-muted` captions on `surface-100` in dark mode in review.

## 3. Confirm page

Route `/notifications/confirm?token=...`. No sign-in. No app shell: a centered card (max 480) on `surface-0` with the HomeGuard logo on top, same as the sign-in page. Shows no device data. The page itself changes nothing on load (GET); only the button POSTs.

Show the address masked: `y***@example.com` (first letter, three stars, domain). Reason: the link is in a mail that can be forwarded.

| State | Content |
|-------|---------|
| Ready | h1 "Turn on email alerts for y***@example.com?" Body: "We'll email you about new Critical problems right away, and a daily summary of new Critical and Vulnerable problems. We won't email you about problems you already have." Button primary "Turn on email alerts". Quiet link "No, not now" to the sign-in/home page. |
| Working | Button disabled with Spinner, text "Turning on..." |
| Success | Check-free info icon (bell). h1 "Email alerts are on." Body: "We only email about new problems. No email does not mean a device is safe." Link "Go to Settings". |
| Already on (token used again) | Same as Success. The action is idempotent; don't scare the person. |
| Expired, forged or malformed | Critical icon. h1 "This link doesn't work." Body is the API text: "This link has expired. Turn on alerts again in Settings > Notifications." Button "Go to Settings" (goes to sign-in first if needed). No address, no account details. |
| Network or server error | Critical icon, "We couldn't turn on email alerts. Try again in a minute." Button "Try again". |
| Email not set up on the server | The API text "Email alerts aren't set up on this HomeGuard yet." |

The success state must not use the green check or the word "safe". Heading focus: move focus to the h1 after each state change.

## 4. Unsubscribe page

Route `/notifications/unsubscribe?token=...`. Same shell as confirm. GET shows the page only.

| State | Content |
|-------|---------|
| Ready | h1 "Stop email alerts for y***@example.com?" Body: "You won't get alerts or daily summaries any more. Your devices are still checked every day. Open My home to see the results." Button primary "Stop email alerts". |
| Working | "Stopping..." |
| Success | h1 "Email alerts are off." Body: "You can turn them on again in Settings." Link "Go to Settings". Caption: "Emails already on their way may still arrive." only if backend cannot guarantee cancel; otherwise omit. |
| Already off | Same as Success. |
| Invalid token | Critical icon, "This link doesn't work." Body: API text and "You can also turn alerts off in Settings > Notifications." Link "Go to Settings". |
| Error | Critical icon, "We couldn't stop email alerts. Try again in a minute." Button "Try again". |

The line "Your devices are still checked every day" is true (nightly rescan) and keeps stopping mail from reading as stopping protection. It does not claim anything is safe.

## 5. Mail wording

Plain text only. Lines wrapped at 72 characters by the builder. No HTML, no images, no tracking. `{...}` are values. Reviewed against N-D16: none of "safe" (except in the footer line), "all clear", "all good", "good news", "up to date".

Common rules:
- Subject is at most 120 characters, control characters removed, starts with the device or count, not with a brand prefix. The `From` display name is "HomeGuard".
- The level always appears as a word: "Critical" or "Vulnerable".
- Fix line: if a fixed version is known, "Update to {version} to fix this." If not, "No fix is known yet. Check the maker's website for news."
- If the finding is in the known-exploited list, add the line "Attackers are already using this problem."
- A "Checked" line gives the time of the last check, so stale data is visible: "Last checked: {date and time}."
- `{base_url}` links use the web app's public URL. Link text is a bare URL on its own line (no HTML).
- Never mention a person's name or any other person's data. Greeting is "Hello," with no name.
- Never mail about Not tracked or ignored findings.

Footer on every mail (CONFIRM, TEST, INSTANT, DIGEST), exactly:

```
--
We only email about new problems. No email does not mean a device is safe.

You get these emails because you turned on email alerts in HomeGuard.
Stop them: {unsubscribe_url}
```

### 5.1 Confirm mail (kind CONFIRM)

Subject: `Confirm email alerts from HomeGuard`

```
Hello,

Someone asked HomeGuard to send email alerts to this address.
If that was you, open this link and press "Turn on email alerts":

{confirm_url}

The link works for 48 hours. Alerts are not on until you do this.

Once they are on, we email you:
- Right away, when a new Critical problem is found on a device.
- Once a day, around 7 am, with new Critical and Vulnerable problems.
  Only on days when there is something new.

We won't email you about problems you already have.

If this was not you, ignore this email. Nothing will be sent.

{footer}
```

### 5.2 Right-away mail (kind INSTANT)

One mail per new Critical finding batch for one run (several findings on one device or on several devices in the same check go in one mail, worst first, at most 5 listed then "and {n} more: {base_url}").

Subject, one device: `{device_name} needs fixing now`
Subject, several devices: `{n} devices need fixing now`

Body, one device:

```
Hello,

{device_name} needs fixing now.

Critical: Security problem in {product}
{one_line_plain_summary}
Attackers are already using this problem.        <- only when exploited
{fix_line}

See the details and what to do:
{device_url}

Last checked: {checked_at}.

{footer}
```

Body, several devices or several problems: one block per device:

```
Hello,

{n} devices need fixing now.

{device_name}
  Critical: Security problem in {product}
  {fix_line}
  {device_url}

{device_name_2}
  ...

and {k} more: {base_url}

Last checked: {checked_at}.

{footer}
```

`{one_line_plain_summary}` is the first sentence of the NVD summary (same rule as the CVE page, change 5), cut at 200 characters. It is stripped of control characters.

Example:

```
Subject: Front door camera needs fixing now

Hello,

Front door camera needs fixing now.

Critical: Security problem in Acme CamOS
A flaw lets someone on your network take control of the camera.
Attackers are already using this problem.
Update to 3.1.2 to fix this.

See the details and what to do:
https://homeguard.example/devices/abc123

Last checked: 25 Oct 2026, 14:05.

--
We only email about new problems. No email does not mean a device is safe.

You get these emails because you turned on email alerts in HomeGuard.
Stop them: https://homeguard.example/notifications/unsubscribe?token=...
```

### 5.3 Daily summary (kind DIGEST)

Sent only when there is something new. No mail when there is nothing.

Subject: `Daily summary: {p} new {problem|problems} on {d} {device|devices}`
Example: `Daily summary: 3 new problems on 2 devices`

```
Hello,

Since the last summary we found {p} new {problem|problems} on {d} {device|devices}.
The worst are first.

{device_name}  (Critical)
  Critical: Security problem in {product}
    {fix_line}
  Vulnerable: Security problem in {product}
    {fix_line}
  {device_url}

{device_name_2}  (Vulnerable)
  Vulnerable: Security problem in {product}
    {fix_line}
  {device_url}

and {k} more devices: {base_url}

This summary only lists new problems. Problems you were told about before
are not repeated. Open My home to see everything that is still open:
{base_url}

Last checked: {checked_at}.

{footer}
```

Rules: devices worst first, at most 20 devices (then "and {k} more devices"), at most 5 problems listed per device then "and {m} more on this device". Singular "problem" when p is 1, "device" when d is 1. A problem held back from a right-away mail (hourly limit) shows up here with the same wording as in a right-away mail. "Problems you were told about before are not repeated" prevents the reader from thinking a short summary means things got better.

### 5.4 Test mail (kind TEST)

Subject: `HomeGuard test email`

```
Hello,

This is a test email. You asked for it with "Send a test email" in
HomeGuard settings.

If you can read this, HomeGuard can send email to this address.

This test says nothing about your devices. Open My home to see them:
{base_url}

{footer}
```

### Mail checklist for the builder tests (NB-3, NE-6)

- None of the banned phrases outside the footer line.
- Footer present and exact on all four kinds.
- Subject without line breaks, at most 120 characters.
- INSTANT and DIGEST always contain a level word and a "Last checked" line.
- The device name appears as plain text only; a name like `Cam\r\nBcc: x` yields a clean subject and a harmless body line.

## 6. Components

Reuse only. No new primitives.

| Need | Component | Notes |
|------|-----------|-------|
| Tab | `SubNav` item `{ href: "/settings/notifications", label: "Notifications" }` | Add to `settings/layout.tsx` ITEMS |
| Switch row | `Switch` from `Field.tsx` | Must support `disabled`, `aria-busy`, `aria-describedby`; confirm it renders `role="switch"` |
| State pill | `Pill` | Needs variants for neutral, update-colored, brand and critical with an icon prop. If `Pill` has no icon slot, add one (an extension of an existing component, not a new one) |
| Risk badges in "What we email you" | `RiskBadge` | Existing |
| Errors | `ErrorText` (icon + text), `Banner critical` | `Banner` today always uses the info icon; for critical use a critical icon (frontend: pass an icon or choose by variant) |
| Cards | `Card` | Existing |
| Landing pages | `Card`, `Button`, `Spinner`, logo block from sign-in | Layout outside `(app)` group, no sidebar |
| Relative time | the existing relative-time helper used for "checked ... ago" | Must also give an absolute `title` |

## 7. Deviations from design screen 06

Recorded as rows 27 to 33 in `docs/design/v1-changes.md` and in plan section 9.

1. Push, weekly report, quiet hours, "Who gets alerts", per-level frequency selects, "Save changes", "Send a test alert" are removed (N-D1, N-D13). A single switch applies immediately; there is no Save button.
2. "How we reach you" becomes "Email alerts" with one switch and explicit states, including Waiting for you and Not set up.
3. "When should we tell you?" becomes the read-only "What we email you" card, and says what is not emailed.
4. The sample is a plain-text mail, not a phone push, and carries "Example".
5. New landing pages (confirm, unsubscribe) and mail wording.
6. The tab "Household & users" stays as Account (earlier change 14), and "Vulnerability scanner" stays as Checks (change 8).
7. The alert sample says "Update to 3.1.2 to fix this." and not the design's "Someone on your Wi-Fi could watch the feed", because that text is hand-written per CVE and V1 uses the NVD summary (change 5).
8. The addresses on the landing pages are masked (backlog NF-5 says show the address; masked is safer because the link can be forwarded).

## 8. Open points for other roles

- Backend: the landing pages need the masked address from the verified token (GET-safe read, no state change). Nothing else about the account may be returned.
- Backend: the "Last checked" time in INSTANT and DIGEST comes from the device's last check; the builder needs it as an input.
- Backend: confirm what the API returns for "can ask again at" so the pending state can count down; otherwise the button text is "Wait a few minutes before asking again" with no number.
- Backend and product-owner: the "7 am" is the server time zone. If the NAS is in UTC, the text will be wrong for the household. Consider showing the time from the API (`digestHour` with time zone name) and keep "7 am" as the fallback.
- Not run here: nothing in this spec was tested in a browser or with a real mail client. Plain-text line wrapping and spam-folder placement are to be tried on a real machine (backlog manual checklist).
