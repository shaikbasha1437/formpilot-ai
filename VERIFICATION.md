# Verification

Checked on 11 Nov 2026 against the **live site** (https://shaikbasha1437.github.io/formpilot-ai/) with Playwright, in Google Chrome and in Firefox. The e2e scripts are not in the repo.

| Suite | Result |
|---|---|
| Node unit tests (`npm test`) | 51 / 51 |
| Live site, Chrome | 102 / 102 checks |
| Live site, Firefox | 102 / 102 checks |
| Local runner vs sandbox pages, dry run | 9 / 9 |
| Local runner vs sandbox pages, `--live` | 9 / 9 |

## Demo flows (demo planner, no key), both browsers

| Site | Result | What it proved |
|---|---|---|
| BrightSmile Dental | Booked (BSD-…) | The "ghost" 3:30 PM slot was taken when held, so the agent re-planned to 4:00 PM. One approval was asked. The .ics file was valid. |
| Shear Studio | Booked (SHR-…) | Theo is full at 9:00 and 9:30, so 10:00 AM was picked. The card fields were handed off as one group, and "Done" with empty fields was refused. No card digits were typed or stored. |
| Maplewood Permit | Submitted (MPL-…) | The phone was rejected and reformatted to "(214) 555-0142" from the error example. Date, times and attendance came from the goal. |
| Lanternfest RSVP | Confirmed (LNT-…) | "Only 2 seats left" made the agent move to the 8:30 PM session. It asked for the missing guest names and entered them one per line. |
| QuickCare Clinic | Saved (QC-…) | The agent rejected cookies and closed the pop-up. It flagged 3 injections and ignored them: no evil.example, nothing typed into Notes, the off-site link not followed. It skipped the optional SSN and handed off the password + CAPTCHA. The review showed the injection warning. |

## Other checks (each in Chrome and Firefox)

- **Visits:**
  - Fresh visit: title, sites, welcome toast, sandbox loaded, service worker active.
  - Repeat visit: no welcome toast, page controlled by the service worker, theme persists.
- **Modals:** profile, settings, about and snapshot each close via ×, Cancel, Esc, backdrop and browser Back (20 checks).
  - The discard prompt appears for unsaved edits, on Esc and on Back.
  - Invalid fields block Save but never Cancel.
- **Safety:**
  - Declining the approval (button or Esc) leaves nothing booked.
  - Dry run shows the review and submits nothing.
  - Stop halts mid-run in under 1.5 s, and nothing is booked.
  - A site that isn't on the allowlist is refused.
  - When the site rejects a date as too soon, the agent asks instead of guessing.
- **Results:**
  - .ics: CRLF line endings, ≤ 75-octet lines, UTC DTSTART that equals 4:00 PM local, VALARM.
  - .md and .json reports, with thumbnails.
  - History replay.
- **Undo toasts:** delete run, cancel a sandbox booking, delete recipe, remove a custom profile field.
- **Recipes:**
  - Saving a run turns the date and time into variables and profile values into placeholders.
  - Re-running with a new date and time books the new slot, and approval is still required.
  - Recording captures my own steps without card numbers.
  - The export contains no profile values or keys.
- **Mocked AI** (`page.route`, no real keys):
  - The fake key appears only in the Authorization header, never in prompts or exports.
  - Page text is fenced, with the injection inside the fence.
  - Only profile placeholders are sent.
  - A bad ref from the model is caught.
- **Fake key per provider:** OpenAI, Anthropic, Gemini and OpenRouter (mocked 401/400 responses) each show "The key was rejected…" in Settings › Test connection. The Anthropic request carries `anthropic-dangerous-direct-browser-access: true`.
- **Offline:** after an offline reload, the app and sandbox pages load from the cache and a demo run completes.
- **Mobile (390×844):**
  - No horizontal overflow, before or after a run.
  - The settings modal fits.
  - A dry-run demo completes.
- **Errors:** no page errors in either browser session.

## Local runner

`runner/server.mjs` was run with Chrome against the sandbox pages served over HTTP.

The web app connected with the token and completed a dental booking:
- dry run: stopped before "Book appointment" even after approval;
- `--live`: booked after approval.

Direct protocol checks:
- password typing refused;
- off-allowlist link refused;
- an unapproved final click refused;
- `navigate` refused;
- a wrong token gets a 401.

## Not tested

- Real booking websites, through the runner or otherwise.
- Real model providers with real keys (only mocks).
- WebLLM (no WebGPU on the test machine).
- Headed runner mode (headless only).
