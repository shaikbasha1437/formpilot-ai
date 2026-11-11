# FormPilot local runner (optional)

Lets the FormPilot web app drive a real Chromium window on your computer with Playwright. It's for real websites, which a hosted web page can't control.

```bash
npm install                                   # also installs Chromium for Playwright
npm start -- --allow example.com              # headed + dry run; prints a token
node server.mjs --allow example.com --live    # allow final clicks you approve in the app
```

| Flag | Meaning |
|---|---|
| `--allow host[,host]` | Required. Hosts it may open and act on (`*.example.com` allowed). |
| `--live` | Allow final submit/book/pay clicks, and only ones approved in the app. Without it the runner stops before submitting (dry run). |
| `--headed` | Show the browser window (`npm start` sets it). |
| `--port 8787` | Port on 127.0.0.1. |
| `--token T` | Use a fixed token instead of a random one. |
| `--origin URL` | Extra web-app origin allowed by CORS (default: the GitHub Pages app and localhost). |

Endpoints (all need the `x-formpilot-token` header): `GET /health`, `POST /open {url}`, `GET /snapshot`, `POST /act {action, approved}`, `POST /highlight {refs}`, `POST /stop`.

Safety rules live in [`policy.cjs`](policy.cjs) and are unit-tested (`npm test` in the repo root):
- localhost only, token required;
- allowlist enforced on every action;
- refuses sensitive fields;
- dry run by default, and final clicks need approval;
- no navigation actions and no Enter key presses;
- off-site links are refused.

Tested locally against the FormPilot sandbox pages (dry run and live), not against real booking sites.
