# Paddle setup (Phase 7)

> First confirm with Paddle that your legal entity, country and payout bank are supported. Don't
> go live before that.

1. **Sandbox account:** create one at sandbox-vendors.paddle.com (production later at
   vendors.paddle.com).
2. **Products and prices** (Catalog): one product per plan (Basic, Growth, Business), each with a
   monthly and a yearly recurring price. Amounts should match the `plans` table (or update the
   table to match).
3. **Keys** (Developer tools → Authentication), added to `.env.local`, never to chat:
   - `PADDLE_API_KEY` (server API key)
   - `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` (client-side token, safe for the browser)
   - `PADDLE_ENVIRONMENT=sandbox`
4. **Price IDs:** set `PADDLE_PRICE_<PLAN>_<MONTHLY|YEARLY>` to the `pri_…` ids.
5. **Notifications** (Developer tools → Notifications): create a destination with
   - URL: `https://<your-domain>/api/billing/webhook` (for local testing use a tunnel such as
     `cloudflared` or `ngrok`);
   - events: `subscription.*`, `transaction.completed`, `transaction.payment_failed`,
     `adjustment.*`.

   Copy the secret into `PADDLE_WEBHOOK_SECRET`.
6. **Approved domain:** set the default payment link / approved domain in Checkout settings to
   your app URL.
7. **Test the flow:**
   1. Restart the app and open **Plan & usage** → *Choose Growth*.
   2. Pay with a Paddle sandbox test card.
   3. The page shows "Payment is being confirmed" until the webhook arrives, then *Active*.
   4. Check **Billing history** and the `webhook_events` table.
8. **Cancel:** *Cancel subscription* keeps access until the period end. Paddle sends
   `subscription.updated` (scheduled cancel), then `subscription.canceled`.
