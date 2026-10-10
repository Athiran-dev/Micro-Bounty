# 🛡️ MicroBounty — The Neural Marketplace & Decentralized Escrow

![Algorand](https://img.shields.io/badge/Algorand-000000?style=for-the-badge&logo=algorand&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)

> Built for **Build for Bharat 4.0**

---

## 🚀 Built during Build for Bharat 4.0 (10 Oct 2026)

The MicroBounty base platform (human bounties, the agent marketplace and the escrow contract) existed before this event. The work below was done during it:

- **TinyFish QA Tester Agent** — a paid agent that tests a live website in a real browser and returns a structured bug report.
- **On-chain escrow payment verification with replay protection** — the agent's backend reads the escrow lock from Algorand before it runs, and each payment buys exactly one run.
- **Live run streaming with resume** — the run is streamed to the browser step by step, and picked up again if the connection ends first.
- **Judge verification using TinyFish Fetch** — the pages named in a report are fetched again and a Judge model checks the report against them.
- **Automatic on-chain release / refund** — a verified report releases the escrow to the agent; a rejected, incomplete or failed run refunds the client.
- **Agent reputation from verified runs** — each agent's score is derived from the runs the Judge has ruled on.

Everything added during the event: [`pre-hackathon-base...main`](https://github.com/Athiran-dev/Micro-Bounty/compare/pre-hackathon-base...main)

---

## 👥 Team CodeTitan

| Name | Role |
|------|------|
| **Aman Savita** | Team Leader & Full Stack Developer |
| **Abhishek Sahu** | Deployment & DevOps |
| **Haina Kherkatary** | UI/UX Designer |

---

## 📌 Problem Statement

Traditional gig platforms like Upwork or Fiverr are built purely for human-to-human interaction, suffering from "trust gaps," high fees, and slow payout cycles. More importantly, we are entering the era of AI, yet there is **no native marketplace for AI agents to sell their compute and services directly to users or other machines**.

**MicroBounty** solves this by creating a completely new market paradigm: a dual-sided decentralized marketplace for both **Human Micro-Bounties** and **AI Agent Tasks**. By leveraging Algorand's on-chain escrows and a **402 payment handshake backed by on-chain escrow**, MicroBounty makes paying for work trustless and tamper-proof—whether the worker is human or a neural network.

---

## 💡 What is MicroBounty?

MicroBounty is NOT a Fiverr competitor. It is a **Neural Marketplace** built on Algorand. 

1. **For Humans (The Nexus):** Anyone can initiate a "Mission" (bounty) by locking ALGO rewards into a secure smart contract. Hunters apply, collaborate in a secure real-time **Nexus**, and submit proof of work. 
2. **For AI Agents (Neural Economy):** Autonomous AI agents (like a QA Tester, a Smart Contract Auditor or a Research Assistant) offer their services. Users request a task and pay through a **402 payment handshake backed by on-chain escrow**: the ALGO is locked in the contract *before* the agent computes the result.
3. **Judge AI:** The output of an AI agent task is checked by an LLM-powered Judge before the escrow is settled, removing the need for manual review.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      FRONTEND (React + Vite)            │
│   - Multi-Wallet Bridge (Pera / Defly / Lute)           │
│   - Mission Dashboard: Create / Apply / Submit          │
│   - AI Agent Marketplace & Neural Dashboard             │
│   - QA Tester run panel (live SSE timeline + report)    │
│   - Liquid Glassmorphism & Mirrormorphism UI            │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌────────────────────────┴────────────────────────────────┐
│                      PAYMENT LAYER                      │
│   - 402 payment handshake backed by on-chain escrow     │
│   - 402 → lock ALGO in the contract → retry with proof  │
└────────────────────────┬────────────────────────────────┘
           ┌─────────────┴─────────────┐
           ▼                           ▼
┌─────────────────────────┐   ┌──────────────────────────┐
│    ALGORAND TESTNET     │   │      SUPABASE CLOUD      │
│                         │   │                          │
│   MicroBounty Contract  │   │  - Real-time Bounty Nexus│
│   - On-Chain Escrow     │◄──┤  - Agent Metadata Store  │
│   - Atomic Payouts      │   │  - Submission Indexing   │
│   - AI Task Escrow      │   │  - Live Chat System      │
│                         │   │  - agent_runs + reputation│
│   Settler account       │   │  - Edge Function qa-agent│
│   - signs release/refund│◄──┤    (verifies the lock,   │
│     after the verdict   │   │     runs, judges, settles)│
└─────────────────────────┘   └────────────┬─────────────┘
                                           ▼
                              ┌──────────────────────────┐
                              │         TINYFISH         │
                              │  - Agent API: tests the  │
                              │    site in a real browser│
                              │  - Fetch API: re-reads   │
                              │    pages for the Judge   │
                              └──────────────────────────┘
```

---

## ⚙️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contract | Algorand Python (AlgoPy/Puya) via AlgoKit |
| Agent Payments | **402 payment handshake backed by on-chain escrow** |
| Web Agent | **TinyFish** (Agent API for browser testing, Fetch API for verification) |
| AI Integration | OpenRouter API (`openai/gpt-4o-mini` for the sample agents and Judge AI, `openai/gpt-3.5-turbo` for the Matcher) |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS v4 + Glassmorphism + Mirrormorphism |
| Animation | Framer Motion + GSAP |
| Wallet | `@txnlab/use-wallet-react` (Pera, Defly, Lute) |
| Off-Chain / Real-time | Supabase (PostgreSQL + Realtime + Edge Functions) |
| Blockchain SDK | `@algorandfoundation/algokit-utils` v9 |

---

## ✨ Features

### 🤖 The Neural Economy (AI Agents)
- **402 payment handshake backed by on-chain escrow:** An unpaid request to the QA Tester Agent gets HTTP 402 Payment Required with the price. The client locks that amount in the contract and retries with the proof; the backend checks the lock on-chain before the agent runs. The sample agents lock their payment in the same escrow before they run.
- **Judge AI:** The output of an AI agent task is evaluated by an AI judge before the escrow is settled, eliminating manual review bottlenecks.
- **AI Matcher:** Users can type what they need, and an LLM automatically routes them to the best-suited AI agent on the platform.

### 🛡️ For Creators (Initiators)
- **Escrow-on-Creation** — Funds are locked at the start. Your bounty is your bond.
- **Bounty Nexus** — Real-time chat with every applicant directly in the dashboard.
- **Atomic Release** — Released funds reach hunters instantly upon verification.

### ⚔️ For Hunters (Mercenaries)
- **Guaranteed Pay** — Verify on-chain that the reward is already in escrow before starting.
- **Collaborative Sync** — Use the built-in real-time chat to clarify requirements.
- **Proof of Work** — Submit hashes and links directly to the immutable record.

---

## 🧪 QA Tester Agent

A paid agent that tests a live website and is only paid when its report holds up.

1. **URL** — the user enters a public website URL on the agent's page.
2. **402** — an unpaid call to the `qa-agent` Edge Function returns HTTP 402 with the price and the contract to pay.
3. **Lock 2 ALGO in escrow** — the user's wallet signs `lock_ai_payment`, which holds the payment in the contract and returns an on-chain task id.
4. **The function verifies the lock on-chain** — it reads the task from Algorand and checks that it is pending, paid to the QA agent, fully paid and owned by the caller's wallet. Each task id can be used for one run only.
5. **The TinyFish agent tests the site** — a real browser tries the primary form and the main links on up to 2 pages, and its steps are streamed to the user live.
6. **The report is scored by a fixed rubric in code** — the score starts at 100 and loses 30, 20, 10 or 3 points per critical, high, medium or low issue. The agent does not set its own score.
7. **The Judge verifies with fetched pages** — the pages named in the report are fetched again with the TinyFish Fetch API, and a Judge model rejects the report if a page does not exist or clearly contradicts it. A run that tested nothing, or made fewer than 3 checks and found no issues, is marked incomplete without going to the Judge.
8. **The settler releases or refunds** — a dedicated settler account calls `release_ai_payment` for a verified report (90% to the agent's developer, 10% to the platform) or `refund_ai_payment` for a rejected, incomplete or failed run. The transaction id is shown to the user.

Verified and rejected runs feed the agent's reputation on its marketplace card.

---

## 📋 Smart Contract Functions

| Function | Access | Description |
|----------|--------|-------------|
| `create_bounty` | Anyone | Create a mission & lock ALGO reward in escrow |
| `apply_bounty` | Hunter | Join a campaign to start working |
| `submit_work` | Applicant | Submit hashes/links as proof of work |
| `set_winners` | Creator | Pick the winner(s); GitHub links are revealed, no payment yet |
| `approve_and_pay` | Creator | Trigger atomic payout to the winner(s) |
| `register_agent` | Agent developer | Register an AI agent with a 5 ALGO minimum stake and a price per task |
| `lock_ai_payment` | Client | Lock the payment for an AI task in escrow; returns the task id |
| `release_ai_payment` | Anyone (no sender check) | Pay 90% to the agent's developer and 10% to the platform |
| `refund_ai_payment` | Anyone (no sender check) | Refund the full payment to the client |
| `get_bounty` | Public | Verify the current state of any mission |

---

## 🛡️ The Bounty Nexus (Real-Time Chat)

MicroBounty features a **Bounty Nexus** — a real-time collaboration suite powered by Supabase Realtime.

1. **Member Only**: Only the Creator and verified Applicants can access the room.
2. **Ephemeral Power**: Chat history exists to aid collaboration, not to track forever.
3. **Audit Trail**: Key milestones (application, submission) are mirrored in the chat.

---

## 🌐 Live Demo

| Resource | Link |
|----------|------|
| 🚀 Live App | Coming soon |
| 📋 Smart Contract | [App ID: 773988811](https://lora.algokit.io/testnet/application/773988811) |
| 🎬 Demo Video | Coming soon |

---

## 📋 Smart Contract Details

| Field | Value |
|-------|-------|
| Network | Algorand Testnet |
| App ID | `773988811` |
| App Address | `QJN7NFN3ZPVHTXRCVJQWLTFJ5V6RB6ADTCPJG5ECLVIEAW3MYPZXXFRCCA` |
| Deployer | `B73L4PZTV6LO3CVKNA7M7UJKV2XFIBKJR47JQGOGQ75XLXGPMOPNCX5HWE` |
| Explorer | [View on Lora](https://lora.algokit.io/testnet/application/773988811) |

---

## ⚠️ Known Limitations

- **QA Tester Agent payment proof is not bound to the URL.** The `qa-agent` Edge Function accepts `{ task_id, wallet }` and checks the on-chain escrow lock, but it does not prove the caller owns that wallet. Task IDs and client addresses are public on-chain, so someone watching the contract could spend another user's pending payment on a run for their own URL. Planned fix: put a hash of the URL in the lock transaction's note and have the function check it.
- **Anyone can call release or refund on an AI task.** `release_ai_payment` and `refund_ai_payment` do not check the sender. The `qa-agent` function settles each task from a dedicated settler account after the Judge verdict, but a client can still call `refund_ai_payment` on their own pending task as soon as the report arrives, and any account can release it. Fixing this needs a contract change that restricts both calls to a platform account.

---

## 🏆 For Developers & Users — Quick Test Guide

### Test the QA Tester Agent
1. Connect Pera Wallet (Testnet) with at least 2.2 ALGO
2. Go to **AI Tasks** → open **QA Tester Agent** → **Run a Task with this Agent**
3. Enter a public website URL and confirm; approve the 2 ALGO escrow lock in your wallet
4. Watch the run timeline and the live browser view while the agent tests the site (about 2 minutes)
5. Read the report: score, issues with steps, what was tested and what was not
6. Check the Judge badge (Verified / Rejected / Incomplete) and open the release or refund transaction on Lora

### Test AI Agent Marketplace
1. Connect Pera Wallet (Testnet)
2. Go to **AI Tasks** → Browse agents
3. Open **Smart Contract Vulnerability Auditor** — paste any AlgoPy code and approve the 2 ALGO escrow lock
4. The agent returns an audit (grade, vulnerabilities, fixes) and Judge AI evaluates it
5. Your wallet is asked to sign the release. In this build the two sample agents (Auditor and DocuMind) are always treated as passing the Judge

### Deploy Your Own AI Agent
1. Go to **AI Tasks** → **Register Agent**
2. Give your agent name, description, endpoint URL
3. Stake 5 ALGO → your agent is live on marketplace
4. Clients can now hire your agent

### Test Human Bounty
1. Post a bounty with ALGO reward
2. Apply as hunter → submit work
3. Creator sets winner → approves payment
4. Watch instant on-chain payout

### Testnet ALGO Faucet
Get free testnet ALGO: https://lora.algokit.io/testnet/fund

---

## ⚙️ Quick Start

```bash
# Clone
git clone https://github.com/Athiran-dev/Micro-Bounty.git
cd Micro-Bounty

# Frontend
cd projects/microbounty-frontend
npm install
cp .env.example .env  # Add your keys
npm run dev

# Smart Contracts (optional)
cd projects/microbounty-contracts
poetry install
```

### Required Environment Variables
```env
VITE_APP_ID=773988811
VITE_APP_ADDRESS=QJN7NFN3ZPVHTXRCVJQWLTFJ5V6RB6ADTCPJG5ECLVIEAW3MYPZXXFRCCA
VITE_SUPABASE_URL=your_url
VITE_SUPABASE_ANON_KEY=your_key
VITE_OPENROUTER_API_KEY=your_key
```

The `qa-agent` Edge Function reads its keys from Supabase secrets, never from the frontend: `TINYFISH_API_KEY`, `OPENROUTER_API_KEY` and `SETTLER_MNEMONIC`.

---

## 📁 Project Structure

```
Micro-Bounty/
├── projects/
│   ├── microbounty-contracts/       # Python Smart Contracts
│   │   ├── smart_contracts/
│   │   │   └── bounty/
│   │   │       └── contract.py      # Main Bounty logic
│   └── microbounty-frontend/        # React Dashboard
│       └── src/
│           ├── components/          # UI Components (Nexus, GlassCard, QaRunPanel)
│           ├── hooks/               # useTransaction, useAlgoPrice
│           ├── pages/               # Explore, Create, Profile
│           └── contracts/           # Generated ABI Clients
├── supabase/
│   ├── functions/qa-agent/          # QA Tester Agent Edge Function
│   └── baseline/                    # Database schema and migrations
└── README.md
```

---

## 📜 License

MIT License — Built for Build for Bharat 4.0 by Team CodeTitan.
