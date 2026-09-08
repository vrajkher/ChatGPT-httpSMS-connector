import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.HTTPSMS_API_KEY;
const FROM = process.env.HTTPSMS_FROM;
const BASE_URL = process.env.HTTPSMS_BASE_URL || "https://api.httpsms.com";

if (!API_KEY) {
  console.error("Missing HTTPSMS_API_KEY");
  process.exit(1);
}
if (!FROM) {
  console.error("Missing HTTPSMS_FROM");
  process.exit(1);
}

function normalizeIndianNumber(value) {
  const s = String(value).trim().replace(/[()\s-]/g, "");
  if (s.startsWith("+")) return s;
  if (/^\d{10}$/.test(s)) return `+91${s}`;
  return s;
}

function createMcpServer() {
  const server = new McpServer({ name: "httpSMS Connector", version: "1.0.0" });

  server.registerTool(
    "preview_sms",
    {
      title: "Preview SMS",
      description: "Use this when the user wants to review an SMS before sending it. This does not send anything.",
      inputSchema: {
        to: z.string().min(8).describe("Recipient mobile number"),
        message: z.string().min(1).max(1600).describe("SMS text")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ to, message }) => {
      const recipient = normalizeIndianNumber(to);
      return {
        content: [{ type: "text", text: `SMS preview only — NOT SENT.\nFrom: ${FROM}\nTo: ${recipient}\nMessage: ${message}` }],
        structuredContent: { sent: false, preview: true, from: FROM, to: recipient, message }
      };
    }
  );

  server.registerTool(
    "send_sms",
    {
      title: "Send SMS through httpSMS",
      description: "Use this only after the user has explicitly approved sending this exact SMS. This tool sends a real SMS from the user's Android SIM through httpSMS.",
      inputSchema: {
        to: z.string().min(8).describe("Recipient mobile number"),
        message: z.string().min(1).max(1600).describe("Exact SMS text to send"),
        confirmed: z.boolean().describe("Must be true only after the user explicitly confirms sending")
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ to, message, confirmed }) => {
      if (confirmed !== true) {
        return {
          isError: true,
          content: [{ type: "text", text: "SMS not sent. Explicit user confirmation is required. Preview the exact recipient and message first." }],
          structuredContent: { sent: false, reason: "confirmation_required" }
        };
      }

      const recipient = normalizeIndianNumber(to);
      const response = await fetch(`${BASE_URL}/v1/messages/send`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": API_KEY },
        body: JSON.stringify({ content: message, from: FROM, to: recipient })
      });

      const raw = await response.text();
      let body;
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }

      if (!response.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `httpSMS rejected the request (${response.status}).` }],
          structuredContent: { sent: false, http_status: response.status, response: body }
        };
      }

      return {
        content: [{ type: "text", text: `SMS accepted by httpSMS for delivery to ${recipient}. HTTP status: ${response.status}.` }],
        structuredContent: {
          accepted: true,
          http_status: response.status,
          from: FROM,
          to: recipient,
          message_id: body?.id ?? null,
          response: body
        }
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/", (_req, res) => res.json({ name: "ChatGPT-httpSMS Connector", status: "ok", mcp_endpoint: "/mcp" }));
app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/mcp", async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", async () => {
    try { await transport.close(); } catch {}
    try { await server.close(); } catch {}
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
  }
});

app.get("/mcp", (_req, res) => res.status(405).set("Allow", "POST").send("Use POST /mcp"));
app.delete("/mcp", (_req, res) => res.status(405).set("Allow", "POST").send("Use POST /mcp"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ChatGPT-httpSMS connector listening on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
