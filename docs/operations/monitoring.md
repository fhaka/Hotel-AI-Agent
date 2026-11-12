# Monitoring and incident response

| Signal | Where | Alert when |
|---|---|---|
| Uptime | `GET /api/health` from an uptime service (Better Stack, UptimeRobot, …) | non-200 twice in a row |
| Server errors | JSON log lines `"event":"server_error"` in the host's logs; optional `ERROR_WEBHOOK_URL` | any (webhook) |
| Scheduler | `/admin` → System health, *Automations* page per business | last run older than 30 min |
| Email delivery | `/admin` failed notifications; Resend dashboard | failures > 0 per day |
| Billing webhooks | `/admin` failed webhooks; Paddle → Notifications log | any failure |
| AI provider | OpenAI dashboard usage and errors; agent turns failing in logs (`[agent]`) | spend spikes, errors |
| Database | Supabase → Reports (CPU, connections, slow queries) | CPU > 80 % sustained |

Errors shown to users carry a **reference** (the digest). Search the logs for it to find the server error.

## Incident steps

1. **Contain:**
   - Switch the affected agent type off for everyone in `/admin/settings`, or suspend a single abusive business.
   - Paddle and Twilio keep retrying while you work.
2. **Fix and deploy** (or roll back via the host).
3. **Personal data breach:**
   - Inform affected customers (controllers) within 48 hours (DPA §5).
   - They may have to notify their authority within 72 hours.
   - Keep a written record.
