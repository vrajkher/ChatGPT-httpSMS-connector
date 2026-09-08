# Agentic ChatGPT ↔ httpSMS Connector

An MCP server that lets ChatGPT act as a controlled SMS agent using your existing httpSMS/httpsms Android setup.

## Agentic flow

Business goal → ChatGPT/Manager Agent → rules → campaign plan → user approval → httpSMS → Android SIM → recipient → reply → classification → follow-up status

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
