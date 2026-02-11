# EasyA Consensus HK — Hackathon Checklist & Materials

Use this as your “submission control center”. Everything that isn’t a direct Google Form field lives here.

**Public repo safety**
- Don’t commit: private keys, admin tokens, emails, WiFi passwords, or any sensitive URLs.
- Keep `.env` files untracked (already gitignored).

---

## Deadlines / requirements (from the Notion + Form)

- **Submission deadline**: `TODO (confirm local time)` — form says **12:00 PM Thursday**.
- **Open source**: repo must remain public/available.
- **README must include**:
  - Demo video link
  - Screenshots of UI
  - Description of how you use the blockchain
  - A video with audio (Loom-style) walking through the repo structure + demo
- **Slides**:
  - Must be Canva
  - Must be publicly viewable
  - Must include team slide + 1-liner bios

---

## What track are you submitting for?

This project cleanly fits the **DeFi application on RobinPump** prompt:
- “Build a DeFi application that makes trading more efficient on RobinPump.fun… smart contract dApp or trading bot… enhanced liquidity / helps traders make more money.”

If you also want to compete in **Trading Track (Volume / PnL)**, plan to run a real bot with tiny capital (see “Live trading plan”).

---

## Materials to produce (do these in order)

### 1) Demo site (URL for judges)

`TODO`

Checklist:
- App loads without needing secrets
- Strategy Builder can generate code + dashboard
- Deploy/Stop works in dry-run mode
- Settings page works without confusing “connected” states

---

### 2) Demo video (for README + judges)

`TODO: Upload link (YouTube / Loom)`

Suggested shot list (2–4 minutes):
- 10s: “trad = Cursor for trading bots on RobinPump”
- 30s: Create a strategy in Strategy Builder (plain English prompt)
- 30s: Show generated **code** + **WHEN/IF/THEN** dashboard
- 30s: Deploy (dry-run) and show logs streaming
- 30s: Show coin list / chart / performance panel updating
- 10s: Settings page + TradDelegate concept (one sentence, no deep dive)

---

### 3) README submission section (required)

Add a section to `README.md` (or create `README_SUBMISSION.md` and link it) with:

- **Demo video**: `TODO`
- **Screenshots**:
  - Dashboard
  - Strategy Builder (chat + visual preview + code tab)
  - Settings (wallet + delegate deposit UI)
- **Blockchain interaction** (copy/paste starter):
  - Base chain, RobinPump pair contracts
  - `viem` wallet client + public client
  - Optional `TradDelegate` contract: deposits + operator trade execution with allowlist + user-only withdrawals
- **Repo walkthrough video (audio)**: `TODO`

---

### 4) Screenshots (for README + slides)

Create `TODO/screenshots/` locally (don’t commit if you don’t want). Capture:
- Home/Dashboard
- Strategy Builder (before + after generation)
- Generated flow dashboard close-up
- Logs panel with trades (dry-run ok)
- Settings: wallet connected + deposited balance UI

---

### 5) Slides (Canva) — follow judging structure

`TODO: Canva link`

Slide outline (fits their required structure):

1. **Team**  
   - Names + 1-liner bios

2. **Problem (30s)**  
   - “Most ‘bot platforms’ are template-locked (grid bots, presets) and fee-heavy. Non-technical users can’t automate the strategies they actually want.”

3. **Solution (30s)**  
   - “Plain English → arbitrary strategy code + visual WHEN/IF/THEN dashboard → deployable bot (safe on-chain execution)”

4. **Demo (30s)**  
   - 3-step demo gif/flow (Prompt → UI+Code → Deploy logs)

5. **How we used blockchain (30s)**  
   - Base, on-chain pair contracts, tx receipts, optional delegation contract

6. **Roadmap / vision (30s)**  
   - Safer sandboxing, strategy marketplace, richer analytics, more venues (optional)

---

### 6) Tweet (required)

Post from a team member account, tag `@EasyA_App`.

Template:
> We built **trad**: Cursor for trading bots on **RobinPump.fun (Base)**.  
> Describe any strategy in English → get real code + a live WHEN/IF/THEN dashboard → deploy. No template lock-in, no subscription bot fees.  
> Demo: `TODO`  
> Repo: `TODO` #EasyA #ConsensusHK

Paste link into `SUBMISSION.md`.

---

### 7) LinkedIn post (required)

Template:
> Shipped **trad** at EasyA x Consensus HK: a natural-language trading bot builder for RobinPump on Base.  
> Highlights: arbitrary strategy generation (not template-locked), auto dashboards, and safe delegated execution.  
> Demo: `TODO`  Repo: `TODO`

Paste link into `SUBMISSION.md`.

---

### 8) EasyA app review (required checkbox)

Do it last (or whenever you have time), then mark complete in `SUBMISSION.md`.

---

## Live trading plan (ONLY if you’re competing in Trading Track)

If you need real trades counted on `robinpump.fun`:

1. Keep defaults safe:
   - Start with **tiny deposit**
   - Keep **risk limits** tight
   - Keep **slippage** reasonable (`TRAD_DEFAULT_SLIPPAGE_BPS`)

2. Recommended mode:
   - Use **TradDelegate** so users deposit ETH and the operator trades

3. Operational checklist:
   - `TRAD_ALLOW_LIVE_TRADING=true`
   - `DRY_RUN=false`
   - `TRAD_ADMIN_TOKEN` set (production requirement)
   - `TRAD_DELEGATE_ADDRESS` configured
   - `OPERATOR_PRIVATE_KEY` funded for gas
   - Pair allowlist enabled in TradDelegate (address or codehash)

4. Have a kill switch:
   - Pause strategies
   - (Optional) pause contract trading (guardian/owner)

---

## Final pre-submit checklist (10 minutes)

- [ ] Demo site works in incognito
- [ ] Canva slides public
- [ ] README has demo video + screenshots + blockchain explanation + repo walkthrough video
- [ ] Tweet posted + link copied
- [ ] LinkedIn post posted + link copied
- [ ] `SUBMISSION.md` filled
- [ ] No secrets committed

