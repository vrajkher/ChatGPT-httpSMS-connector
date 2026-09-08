# ChatGPT ↔ httpSMS Connector

A minimal tool-only MCP server that lets ChatGPT send SMS through your existing httpSMS/httpsms Android setup.

## Flow

ChatGPT → MCP connector → `https://api.httpsms.com/v1/messages/send` → httpSMS Android app → your SIM → recipient

## Tools

- `preview_sms` — previews the exact recipient and message without sending.
- `send_sms` — sends a real SMS only when `confirmed=true`.

## Requirements

- Working httpSMS Android setup
- Node.js 20+
- httpSMS API key
- Your phone/SIM number registered in httpSMS

## Install

```bash
npm install
```

Set environment variables:

```env
HTTPSMS_API_KEY=your_real_key
HTTPSMS_FROM=+91XXXXXXXXXX
HTTPSMS_BASE_URL=https://api.httpsms.com
PORT=3000
```

Never commit your real API key.

## Run

### Windows PowerShell

```powershell
$env:HTTPSMS_API_KEY="YOUR_KEY"
$env:HTTPSMS_FROM="+91XXXXXXXXXX"
npm start
```

### macOS/Linux

```bash
export HTTPSMS_API_KEY="YOUR_KEY"
export HTTPSMS_FROM="+91XXXXXXXXXX"
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

## Connect to ChatGPT

ChatGPT cannot normally call `localhost` on your laptop. Deploy this connector to a public HTTPS host, or expose it through a secure HTTPS tunnel.

Then use the public MCP URL:

```text
https://YOUR-DOMAIN/mcp
```

Keep `HTTPSMS_API_KEY` only in your host's secret environment variables.

## Security

- Never paste your httpSMS API key into a chat.
- Never commit it to GitHub.
- Use HTTPS only.
- Add authentication before production use.
- Keep the confirmation requirement enabled.

## httpSMS API

This connector calls:

`POST https://api.httpsms.com/v1/messages/send`

with header:

`x-api-key: <your httpSMS API key>`

and body containing `content`, `from`, and `to`.
