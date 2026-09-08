# Agentic ChatGPT ↔ httpSMS Connector

An MCP server that lets ChatGPT act as a controlled SMS agent using your existing httpSMS/httpsms Android setup.

## Agentic flow

Business goal → ChatGPT/Manager Agent → rules → campaign plan → user approval → httpSMS → Android SIM → recipient → reply → classification → follow-up status

## Concrete example: EPF follow-up agent

### Goal

> Get July EPF details from all pending offices by 5:00 PM today.

### 1. Agent plans

The agent reads the contact/status master, identifies only pending offices, chooses the approved EPF reminder text, and creates a campaign plan.

Example pending offices:

- Dholka
- Mandal
- Borsad ANA
- Kathana
- Undel
- Sayala SDA
- Wadhwan SDA

Example SMS:

> Kindly submit July 2026 EPF details by 5:00 PM today. If EPF is not applicable or demand is NIL, please confirm the same.

### 2. Rules check

Before sending, the rule engine verifies:

- do not message offices already marked complete
- do not send the same reminder to the same number inside the configured repeat window
- use only configured contact numbers
- stay within the maximum campaign size
- require explicit user approval before real bulk sending

### 3. User approval

The agent should present the exact recipients and exact message before sending.

Example:

> 7 offices are pending. Send this approved EPF reminder to all 7?

Only after the user explicitly approves should `send_campaign` be called with confirmation enabled.

### 4. Send

The connector sends the approved messages through:

ChatGPT → MCP connector → httpSMS API → Android phone → SIM → recipient

Each send result is stored in campaign state.

### 5. Record replies

Example replies:

- Dholka: `Submitted`
- Mandal: `No EPF this month`
- Kathana: `Will send by 4 PM`
- Undel: no reply

Replies can be recorded through `record_reply` or through the incoming SMS webhook endpoint.

### 6. Classify

The reply agent converts free-text replies into business status:

- `Submitted` → `completed`
- `No EPF this month` → `no_data`
- `Need format / please help` → `need_help`
- unclear or future promise → `unknown`

### 7. Identify pending follow-up

The agent checks campaign state again instead of blindly resending to everyone.

Example result:

- 5 offices completed
- Kathana still pending / promised
- Undel still pending / no response

Only Kathana and Undel should appear in the next follow-up list.

### Why this is agentic

The business goal is **not** "send 7 SMS".

The business goal is **"complete EPF collection from every required office"**.

The agent therefore plans, checks rules, requests approval, acts, observes replies, updates state, and decides what still needs attention.

## MCP tools

- `list_contacts` — read the configured office/contact master.
- `preview_sms` — preview one SMS without sending.
- `plan_sms_campaign` — convert a goal + recipients + message into a stored campaign plan.
- `send_sms` — send one real SMS after explicit confirmation.
- `send_campaign` — execute an approved campaign while enforcing bulk/repeat rules.
- `record_reply` — record and classify a reply as `completed`, `no_data`, `need_help`, or `unknown`.
- `get_agent_status` — show campaign state, replies, and follow-ups that are due.

## Rule engine

Rules are stored in `agent-rules.json`.

Current defaults:

- max 25 recipients per campaign
- no repeat message to the same number within 4 hours
- explicit confirmation required before real sending
- default follow-up check after 24 hours
- deterministic reply classification for common completion/no-data/help phrases

## Contact master

`contacts.example.json` shows the format. For real use, create a private `contacts.json` file or mount one at deploy time and set:

```env
CONTACTS_FILE=./contacts.json
```

Do not commit confidential contact data to a public repository.

## Requirements

- Working httpSMS Android setup
- Node.js 20+
- httpSMS API key
- Your phone/SIM number registered in httpSMS

## Install

```bash
npm install
```

## Environment variables

```env
HTTPSMS_API_KEY=your_real_key
HTTPSMS_FROM=+91XXXXXXXXXX
HTTPSMS_BASE_URL=https://api.httpsms.com
PORT=3000
CONNECTOR_BEARER_TOKEN=long_random_secret
HTTPSMS_WEBHOOK_TOKEN=another_random_secret
```

Never commit the real secrets.

## Run

```bash
npm start
```

Health check:

```text
http://localhost:3000/health
```

MCP endpoint:

```text
http://localhost:3000/mcp
```

## Security

Before public deployment, set `CONNECTOR_BEARER_TOKEN`. `/mcp` will then require:

```text
Authorization: Bearer <your secret>
```

Incoming webhook processing is disabled unless `HTTPSMS_WEBHOOK_TOKEN` is set. When enabled, `/webhooks/httpsms` requires:

```text
x-webhook-token: <your webhook secret>
```

Keep user approval enabled for external or bulk messages until your rules and contacts are tested.

## Incoming SMS

The connector includes `/webhooks/httpsms` as the agent-side receiver. You still need to configure the exact httpSMS webhook payload/secret arrangement in your httpSMS account. The handler accepts common fields such as `from`, `sender`, `phone` and `content`, `message`, or `text`.

## Important limitation of this MVP

Campaigns, replies, and send history are currently kept in process memory. A server restart clears this state. For production, replace this with Redis/PostgreSQL/ERPNext storage before relying on autonomous follow-up.

## httpSMS API

Real sending uses:

`POST https://api.httpsms.com/v1/messages/send`

with `x-api-key` authentication and `content`, `from`, and `to` in the request body.

## Next production upgrade

Recommended next step: persistent state + official incoming-message integration + delivery-status polling/webhooks + ERPNext tools. That changes this from an agentic SMS MVP into a closed-loop business agent.
