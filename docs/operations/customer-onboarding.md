# Customer onboarding process

## Self-service (all plans)

1. **Sign up → verify email.** The hotel accepts the Terms and Privacy Notice at sign-up.
2. **Setup wizard (≈ 15 min):** company details → hours, policies, FAQs → room types and rooms. The 7-day trial starts
   when the workspace is created.
3. **Try it:** in the *Playground*, staff test the receptionist and the reservation assistant (test bookings only).
4. **Go live on the website:**
   - Channels → Website chat: add their website address.
   - Paste the embed code into their site (or send it to their web agency).
5. **Invite the team** (Team page) and check *Automations* (reminder emails, daily summary).
6. **Choose a plan** before the trial ends (Plan & usage). Paddle handles payment, invoices and VAT.

Automatic emails support this: a welcome email, a "trial ends in 48 h" reminder, and a "trial ended" notice.

## Done by the operator (Business plan with phone / WhatsApp)

1. The customer asks for phone service. Agree on the country and number type.
2. Buy the number in Twilio and set its webhooks (`docs/setup/channels.md`).
3. In **/admin → Businesses → (business) → Phone numbers**, assign it.
4. The customer turns the phone agent on in Channels and sets a transfer number. Place a test call together.
5. WhatsApp: register the sender with Meta through Twilio (takes days). Assign it the same way when it is approved.

## First-week check-in (recommended)

- `/admin` → business detail: usage, conversations, any failed emails.
- Review a few conversations with the customer. Gaps in answers usually mean the knowledge base is missing something.
- Ask for the customer's privacy notice: it should mention the AI assistant and HotelAI as processor.

## Offboarding

- The customer exports their data (*Data & privacy*), cancels in Plan & usage, then deletes the workspace.
- Release any phone number in /admin and in Twilio.
