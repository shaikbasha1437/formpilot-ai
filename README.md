# FormPilot AI

A browser agent that fills in forms and books appointments. You type a goal, for example *"Book a cleaning with Dr. Patel next Tuesday after 3pm"*. The agent reads the page, plans one step at a time and fills it in with a visible cursor. It explains each step, asks you for anything it doesn't know, and stops for your approval before it books or submits anything.

**Live demo:** https://shaikbasha1437.github.io/formpilot-ai/ (no sign-up, no key needed for the demo)

> All five demo sites are **fictional sandboxes** served by this app (`*.example` domains, made-up people). Nothing real is booked, and nothing leaves your browser in demo mode.

## What it does

- **Agent loop:** accessibility snapshot (roles, labels, values, numbered refs) → plan → act. You see a fake cursor, the target is highlighted, and a step log shows the reasoning. Steps are capped, failed actions are retried, and the agent re-plans when a slot or seat is taken.
- **Five sandbox sites,** each with a different challenge:
  | Site | What makes it tricky |
  |---|---|
  | BrightSmile Dental | Multi-step wizard with a month calendar. A "ghost" 3:30 PM slot gets taken just as you pick it, so the agent re-plans to 4:00. |
  | Shear Studio (salon) | Single page with a day strip and full slots. The card fields are handed to you. |
  | Maplewood Permit Center | Strict formats: phone must look like "(555) 555-0123". The agent reads the error and reformats. It also uses a native date input and conditional fields. |
  | Lanternfest RSVP | Seats run out: "Only 2 seats left" makes the agent switch sessions. It asks you for guest names it doesn't know. |
  | QuickCare Clinic | Cookie wall, newsletter pop-up, optional SSN, password + CAPTCHA, and hidden **prompt-injection** text, a poisoned menu option and an off-site link. |
- **Your profile** is stored locally and editable. The agent fills forms from it and **asks** for anything missing instead of inventing it. You can save answers back to the profile.
- **Safety:**
  - Approval gate with a full review of what will be sent before any final book / submit / pay / send click. Declining submits nothing.
  - Never types passwords, card numbers, SSNs, one-time codes or CAPTCHAs: it highlights them and hands them to you.
  - Page text is treated as data. Injected instructions are flagged and ignored, and typed values must come from your profile, goal or answers.
  - Domain allowlist, so links to other domains are not followed.
  - **Stop** halts immediately, even mid-typing or while waiting on you.
  - **Dry-run** mode stops before submitting.
- **After a run:**
  - The confirmation is captured.
  - **.ics** calendar file.
  - Markdown / JSON report with every step and wireframe thumbnails.
  - Run history with step-by-step **replay**.
- **Recipes:** record yourself using a site, or save a successful run, to get reusable steps with variables (`{{date}}`, `{{time}}`, `{{profile.email}}`). Run them again later, import or export them.
- **Planners:**
  - *Demo planner*: deterministic rules, free, no key.
  - *Your AI*: OpenAI, Anthropic, Google Gemini, or any OpenAI-compatible server (OpenRouter, Ollama, LM Studio) with your own key.
  - *In-browser*: WebLLM, experimental, needs WebGPU.
- **PWA:** installable, works offline (network-first service worker), light/dark theme, mobile layout.

## Your key and your data

- Keys are stored only in this browser's localStorage (or only in memory if you untick "Remember"). They are sent only to the provider you choose, in a request header.
- Keys never appear in prompts, logs, reports, recipes or exports.
- By default the model sees your profile **field names** as placeholders (`{{profile.email}}`) and FormPilot fills the values in locally. Sharing the actual values with the model is an opt-in setting.
- Anthropic calls from the browser use the `anthropic-dangerous-direct-browser-access` header (required for browser use).
- OpenAI's error responses for bad keys have no CORS headers, so a wrong OpenAI key shows up as a network error. The app tells you this.

## Real websites: the optional local runner

A static web page can't read or control other websites (browsers block cross-site access), so the hosted app drives only the sandbox sites. For real sites there's a small **Node + Playwright runner** in [`runner/`](runner/) that drives a Chromium window on your computer, using the same snapshot/act protocol:

```bash
cd runner
npm install                          # installs Playwright + Chromium
npm start -- --allow example.com     # headed, dry run, prints a token
```

Then in FormPilot: **Settings → Local runner**, paste the token, add the domain to your allowlist, pick "Real site via local runner…", and enter the start page.

The runner:
- listens on `127.0.0.1` only, and every request needs the token;
- runs **dry-run by default**, stopping before any final submit. Add `--live` to allow final clicks, and even then only clicks you approved in the app;
- refuses to type into password, card, SSN, code or CAPTCHA fields;
- opens and acts only on `--allow` hosts, and goes back if a page leaves them;
- never presses Enter in fields, so nothing is submitted by accident.

Chrome and Firefox may ask you to allow the page to access devices on your local network. Allow it for this site only.

**Browser extension:** not included. I considered an MV3 extension, but branded Chrome no longer supports loading unpacked extensions from the command line, so I couldn't test it automatically. I didn't want to ship something untested. The runner covers the real-site case.

## Honest limits

- The hosted demo drives **fictional sandbox pages** in an iframe with DOM events, not OS-level input. The runner uses real Playwright input. It was tested against the sandbox pages served over HTTP, **not against real booking sites**.
- The demo planner is rules-based. It handles the sandbox sites and similar well-labelled forms. Messy real pages need "Your AI", and the quality then depends on your model.
- "Your AI" mode was tested with **mocked** model replies and mocked provider errors (no real keys were used). WebLLM was not tested (no GPU on the test machine).
- Prompt-injection detection is pattern-based and can miss things. The main protections are structural: page text is fenced as data, typed values are checked against your own data, final steps need your approval, and other domains are blocked.
- CAPTCHA and card fields in the sandbox are fake. Use the test card `4242 4242 4242 4242`.

## Development

```bash
npm test                      # 48 Node tests: goal parser, guard, planner, agent loop, LLM prompts, providers, .ics, reports, recipes, sandbox, runner policy
python3 -m http.server 8080   # then open http://localhost:8080/
```

No build step: plain HTML, CSS and JavaScript (UMD modules that also load in Node for tests). See [VERIFICATION.md](VERIFICATION.md) for the browser checks.

## License

MIT
