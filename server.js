import express from "express";
import fs from "fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.HTTPSMS_API_KEY;
const FROM = process.env.HTTPSMS_FROM;
const BASE_URL = process.env.HTTPSMS_BASE_URL || "https://api.httpsms.com";
const CONNECTOR_BEARER_TOKEN = process.env.CONNECTOR_BEARER_TOKEN || "";
const WEBHOOK_TOKEN = process.env.HTTPSMS_WEBHOOK_TOKEN || "";

if (!API_KEY) {
  console.error("Missing HTTPSMS_API_KEY");
  process.exit(1);
}
if (!FROM) {
  console.error("Missing HTTPSMS_FROM");
  process.exit(1);
}
if (!CONNECTOR_BEARER_TOKEN) {
  console.warn("WARNING: CONNECTOR_BEARER_TOKEN is not set. Do not expose /mcp publicly without authentication.");
}

const rules = JSON.parse(fs.readFileSync(new URL("./agent-rules.json", import.meta.url), "utf-8"));
const contactsPath = process.env.CONTACTS_FILE || new URL("./contacts.example.json", import.meta.url);
let contacts = [];
try {
  contacts = JSON.parse(fs.readFileSync(contactsPath, "utf-8"));
} catch (err) {
  console.warn("Could not load contacts file:", err.message);
}

const campaigns = new Map();
const replies = [];
const sendHistory = [];

function normalizeIndianNumber(value) {
  const s = String(value).trim().replace(/[()\s-]/g, "");
  if (s.startsWith("+")) return s;
  if (/^\d{10}$/.test(s)) return `+91${s}`;
  return s;
}

function classifyReply(text) {
  const value = String(text || "").toLowerCase();
  for (const [label, keywords] of Object.entries(rules.replyClasses || {})) {
    if (keywords.some((k) => value.includes(String(k).toLowerCase()))) return label;
  }
  return "unknown";
}

function resolveRecipient(value) {
  const raw = String(value).trim();
  const byId = contacts.find((c) => c.id === raw);
  const byName = contacts.find((c) => String(c.name).toLowerCase() === raw.toLowerCase());
  const contact = byId || byName;
  if (contact) {
    return { id: contact.id, name: contact.name, phone: normalizeIndianNumber(contact.phone) };
  }
  return { id: null, name: null, phone: normalizeIndianNumber(raw) };
}

function hoursSinceLastSend(phone) {
  const latest = [...sendHistory].reverse().find((x) => x.to === phone);
  if (!latest) return Infinity;
  return (Date.now() - latest.sent_at) / 3600000;
}

async function sendViaHttpSms(to, message) {
  const response = await fetch(`${BASE_URL}/v1/messages/send`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ content: message, from: FROM, to })
  });

  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }

  if (!response.ok) {
    const error = new Error(`httpSMS rejected the request (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  sendHistory.push({ to, message, sent_at: Date.now(), http_status: response.status, response: body });
  return { http_status: response.status, body };
}

function createCampaignId() {
  return `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createMcpServer() {
  const server = new McpServer({ name: "Agentic httpSMS Connector", version: "2.0.0" });

  server.registerTool(
    "list_contacts",
    {
      title: "List SMS contacts",
      description: "Returns the configured office/contact master available to the agent.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => ({
      content: [{ type: "text", text: `Loaded ${contacts.length} contacts.` }],
      structuredContent: { contacts }
    })
  );

  server.registerTool(
    "preview_sms",
    {
      title: "Preview SMS",
      description: "Preview an SMS before sending. This never sends anything.",
      inputSchema: {
        to: z.string().min(3),
        message: z.string().min(1).max(1600)
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ to, message }) => {
      const recipient = resolveRecipient(to);
      return {
        content: [{ type: "text", text: `SMS preview only — NOT SENT.\nFrom: ${FROM}\nTo: ${recipient.name || recipient.phone} (${recipient.phone})\nMessage: ${message}` }],
        structuredContent: { sent: false, preview: true, from: FROM, to: recipient, message }
      };
    }
  );

  server.registerTool(
    "plan_sms_campaign",
    {
      title: "Plan SMS campaign",
      description: "Turn a business goal into a controlled SMS campaign plan. The plan is stored in connector state but sends nothing.",
      inputSchema: {
        goal: z.string().min(3),
        message: z.string().min(1).max(1600),
        recipients: z.array(z.string().min(3)).min(1),
        follow_up_hours: z.number().int().min(1).max(720).optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ goal, message, recipients, follow_up_hours }) => {
      const resolved = recipients.map(resolveRecipient);
      const unique = [...new Map(resolved.map((r) => [r.phone, r])).values()];
      if (unique.length > rules.maxBulkRecipients) {
        return {
          isError: true,
          content: [{ type: "text", text: `Plan rejected: ${unique.length} recipients exceeds maxBulkRecipients=${rules.maxBulkRecipients}.` }],
          structuredContent: { planned: false, reason: "bulk_limit", max: rules.maxBulkRecipients }
        };
      }

      const campaign = {
        id: createCampaignId(),
        goal,
        message,
        recipients: unique,
        follow_up_hours: follow_up_hours || rules.defaultFollowUpHours,
        status: "planned",
        created_at: new Date().toISOString(),
        results: []
      };
      campaigns.set(campaign.id, campaign);

      return {
        content: [{ type: "text", text: `Campaign ${campaign.id} planned for ${unique.length} recipient(s). Nothing has been sent yet.` }],
        structuredContent: campaign
      };
    }
  );

  server.registerTool(
    "send_sms",
    {
      title: "Send SMS through httpSMS",
      description: "Send one real SMS only after explicit approval of the exact recipient and message.",
      inputSchema: {
        to: z.string().min(3),
        message: z.string().min(1).max(1600),
        confirmed: z.boolean()
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ to, message, confirmed }) => {
      if (confirmed !== true) {
        return { isError: true, content: [{ type: "text", text: "SMS not sent. Explicit confirmation is required." }], structuredContent: { sent: false, reason: "confirmation_required" } };
      }

      const recipient = resolveRecipient(to);
      if (hoursSinceLastSend(recipient.phone) < rules.minimumRepeatHours) {
        return {
          isError: true,
          content: [{ type: "text", text: `SMS blocked by rule: a message was sent to ${recipient.phone} within the last ${rules.minimumRepeatHours} hour(s).` }],
          structuredContent: { sent: false, reason: "repeat_window" }
        };
      }

      try {
        const result = await sendViaHttpSms(recipient.phone, message);
        return {
          content: [{ type: "text", text: `SMS accepted by httpSMS for ${recipient.name || recipient.phone}.` }],
          structuredContent: { accepted: true, to: recipient, message_id: result.body?.id ?? null, ...result }
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: err.message }], structuredContent: { sent: false, http_status: err.status || null, response: err.body || null } };
      }
    }
  );

  server.registerTool(
    "send_campaign",
    {
      title: "Send approved SMS campaign",
      description: "Execute a previously planned campaign. Requires explicit confirmation and enforces bulk/repeat rules.",
      inputSchema: {
        campaign_id: z.string().min(3),
        confirmed: z.boolean()
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ campaign_id, confirmed }) => {
      const campaign = campaigns.get(campaign_id);
      if (!campaign) return { isError: true, content: [{ type: "text", text: "Campaign not found." }] };
      if (confirmed !== true) return { isError: true, content: [{ type: "text", text: "Campaign not sent. Explicit user confirmation is required." }] };
      if (campaign.status !== "planned") return { isError: true, content: [{ type: "text", text: `Campaign is already ${campaign.status}.` }] };

      campaign.status = "sending";
      for (const recipient of campaign.recipients) {
        if (hoursSinceLastSend(recipient.phone) < rules.minimumRepeatHours) {
          campaign.results.push({ to: recipient, status: "skipped_repeat_window" });
          continue;
        }
        try {
          const result = await sendViaHttpSms(recipient.phone, campaign.message);
          campaign.results.push({ to: recipient, status: "accepted", message_id: result.body?.id ?? null, http_status: result.http_status });
        } catch (err) {
          campaign.results.push({ to: recipient, status: "failed", error: err.message, http_status: err.status || null });
        }
      }
      campaign.status = "sent";
      campaign.sent_at = new Date().toISOString();
      campaigns.set(campaign.id, campaign);

      const accepted = campaign.results.filter((r) => r.status === "accepted").length;
      const failed = campaign.results.filter((r) => r.status === "failed").length;
      const skipped = campaign.results.filter((r) => r.status.startsWith("skipped")).length;
      return {
        content: [{ type: "text", text: `Campaign complete: ${accepted} accepted, ${failed} failed, ${skipped} skipped by rules.` }],
        structuredContent: campaign
      };
    }
  );

  server.registerTool(
    "record_reply",
    {
      title: "Record and classify SMS reply",
      description: "Record an incoming reply and classify it as completed, no_data, need_help, or unknown.",
      inputSchema: {
        from: z.string().min(3),
        message: z.string().min(1).max(5000)
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ from, message }) => {
      const sender = resolveRecipient(from);
      const item = { from: sender, message, classification: classifyReply(message), received_at: new Date().toISOString() };
      replies.push(item);
      return {
        content: [{ type: "text", text: `Reply classified as ${item.classification}.` }],
        structuredContent: item
      };
    }
  );

  server.registerTool(
    "get_agent_status",
    {
      title: "Get agent status",
      description: "Summarize campaign state, replies, and pending follow-up conditions.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      const campaignList = [...campaigns.values()];
      const now = Date.now();
      const followUpsDue = campaignList.flatMap((c) => {
        if (!c.sent_at) return [];
        const dueAt = new Date(c.sent_at).getTime() + c.follow_up_hours * 3600000;
        if (now < dueAt) return [];
        return c.recipients.filter((r) => !replies.some((reply) => reply.from.phone === r.phone && ["completed", "no_data"].includes(reply.classification))).map((r) => ({ campaign_id: c.id, recipient: r, due_at: new Date(dueAt).toISOString() }));
      });

      return {
        content: [{ type: "text", text: `${campaignList.length} campaign(s), ${replies.length} reply/replies, ${followUpsDue.length} follow-up(s) due.` }],
        structuredContent: { campaigns: campaignList, replies, follow_ups_due: followUpsDue }
      };
    }
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "128kb" }));

app.get("/", (_req, res) => res.json({ name: "Agentic ChatGPT-httpSMS Connector", version: "2.0.0", status: "ok", mcp_endpoint: "/mcp" }));
app.get("/health", (_req, res) => res.json({ ok: true, agentic: true, contacts: contacts.length }));

function requireMcpAuth(req, res, next) {
  if (!CONNECTOR_BEARER_TOKEN) return next();
  const auth = req.get("authorization") || "";
  if (auth !== `Bearer ${CONNECTOR_BEARER_TOKEN}`) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.post("/mcp", requireMcpAuth, async (req, res) => {
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

app.post("/webhooks/httpsms", (req, res) => {
  if (!WEBHOOK_TOKEN) return res.status(503).json({ error: "webhook_disabled", message: "Set HTTPSMS_WEBHOOK_TOKEN to enable incoming webhook processing." });
  if ((req.get("x-webhook-token") || "") !== WEBHOOK_TOKEN) return res.status(401).json({ error: "unauthorized" });

  const payload = req.body || {};
  const from = payload.from || payload.phone || payload.sender;
  const message = payload.content || payload.message || payload.text;
  if (!from || !message) return res.status(400).json({ error: "missing_from_or_message" });

  const sender = resolveRecipient(from);
  const item = { from: sender, message: String(message), classification: classifyReply(message), received_at: new Date().toISOString(), raw: payload };
  replies.push(item);
  res.json({ ok: true, classification: item.classification });
});

app.get("/mcp", (_req, res) => res.status(405).set("Allow", "POST").send("Use POST /mcp"));
app.delete("/mcp", (_req, res) => res.status(405).set("Allow", "POST").send("Use POST /mcp"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Agentic ChatGPT-httpSMS connector listening on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
