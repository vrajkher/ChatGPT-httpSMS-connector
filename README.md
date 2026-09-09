# Agentic ChatGPT ↔ SMS Gateway for Android Connector

This MCP server lets ChatGPT act as a controlled SMS agent using **SMS Gateway for Android** and the SIM in your Android phone.

## Final flow

ChatGPT → MCP connector → SMS Gateway API → Android phone → SIM → recipient → reply/webhook → classification → follow-up.

## What changed

This branch replaces the old httpSMS-specific sending layer with the open-source `capcom6/android-sms-gateway` API.

Default cloud endpoint:

```text
https://api.sms-gate.app/3rdparty/v1/message
```

Local/LAN mode is also supported by setting `SMSGATE_BASE_URL`, for example:

```text
http://192.168.1.123:8080
```

Both modes use the username/password shown by the Android app. Keep those credentials private.

## MCP tools

- `list_contacts` — read configured contacts.
- `preview_sms` — preview one SMS without sending.
- `send_sms` — send one SMS after explicit confirmation.
- `plan_sms_campaign` — create a campaign plan without sending.
- `send_campaign` — execute an approved campaign with repeat/bulk rules.
- `record_reply` — record and classify a reply.
- `get_agent_status` — show campaigns, replies and pending follow-ups.

## Safety/rules

Rules are in `agent-rules.json`.

Current behavior includes explicit confirmation before real sends, repeat-window protection and campaign-size limits. Do not use this gateway for unsolicited or high-volume bulk messaging; mobile operators may restrict such use.

## Android setup

1. Install SMS Gateway for Android.
2. Grant `SEND_SMS` permission.
3. For cloud mode, enable **Cloud Server** and keep the service Online.
4. Copy the Cloud Server username/password into your deployment environment — never into source code or GitHub.
5. For local mode, enable **Local Server** and point `SMSGATE_BASE_URL` to the phone IP and port 8080.

## Install connector

```bash
npm install
```

Create `.env` from `.env.example` and set:

```env
SMSGATE_USERNAME=your_gateway_username
SMSGATE_PASSWORD=your_gateway_password
SMSGATE_BASE_URL=https://api.sms-gate.app/3rdparty/v1
PORT=3000
CONNECTOR_BEARER_TOKEN=use_a_long_random_secret
SMSGATE_WEBHOOK_TOKEN=use_another_random_secret
```

Do not commit `.env`.

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

If `CONNECTOR_BEARER_TOKEN` is set, MCP requests require:

```text
Authorization: Bearer <your secret>
```

## First single-SMS test

Use the MCP tool `send_sms` with an E.164 number, message text and `confirmed=true` only after the exact recipient/message have been approved.

Example business instruction:

```text
Send “How r u” to +919726399693.
```

The connector converts a plain 10-digit Indian number to `+91...` automatically.

## Incoming replies

Webhook receiver:

```text
POST /webhooks/smsgateway
```

Protect it with `SMSGATE_WEBHOOK_TOKEN`. Incoming received-message events are recorded and classified for agent follow-up.

## Production note

Campaigns, replies and send history are still kept in process memory. A restart clears them. Before autonomous production use, persist state in PostgreSQL/Redis/ERPNext and configure the official SMS Gateway webhook to this connector.
