# Customer channels (Phase 9)

All channels use the same agent runtime as the playground: same knowledge, rules, booking
protocol, plan and usage limits. Conversations appear under **Conversations**.

## Website chat widget

1. **Channels → Website chat:** turn it on and add the websites where it may appear, for
   example `https://www.yourhotel.com`. Browsers refuse to show the chat anywhere else (CSP
   `frame-ancestors`).
2. Paste the embed code before `</body>` on your site:
   ```html
   <script src="https://YOUR-APP-DOMAIN/widget.js" data-key="wk_..." async></script>
   ```
   Optional attributes: `data-color="#1f57d6"`, `data-position="left"`.
3. The chat shows "You are chatting with an AI assistant". The visitor's conversation is
   private to their browser (a random token; only its hash is stored).

## Phone (Twilio Programmable Voice)

Phone calls need the **Business** plan (it includes the voice minutes).

1. **Twilio account:**
   - Copy the **Auth Token** into `TWILIO_AUTH_TOKEN` (server only, never in chat).
   - Buy a phone number in the hotel's country.
2. **Number configuration** in the Twilio console, *Voice*:
   - *A call comes in*: Webhook, `POST https://YOUR-APP-DOMAIN/api/channels/twilio/voice`
   - *Call status changes*: `POST https://YOUR-APP-DOMAIN/api/channels/twilio/voice/status`
3. **Assign the number to the business** (operator only, Supabase SQL editor):
   ```sql
   select public.assign_channel_address('<business uuid>', 'voice', '+355691234567');
   ```
4. **Enable** in Channels → Phone: choose the call language and, optionally, the number calls
   are transferred to when a caller needs a person.

How a call works:
- The caller hears the business greeting and an AI disclosure.
- Each sentence they say is transcribed by Twilio and sent through the agent runtime, and the
  answer is spoken back.
- If the AI hands over and a transfer number is set, the call is forwarded.
- After the call, minutes are recorded, and staff get a summary email (sent by the scheduled
  job, Phase 8).
- Calls are **not recorded**; only the text transcript is kept, like chat.

Known limitations:
- **Languages:** only languages Twilio can both recognise and speak are offered (20). Albanian,
  Croatian and Slovenian can be recognised but have no built-in voice, so they need an external
  text-to-speech service (future work).
- **Latency:** every answer waits for the model (and tools), and Twilio allows about 15 seconds
  per webhook. Slow turns are capped at about 11 seconds, after which the caller is asked to
  repeat. Choose a fast `OPENAI_MODEL` for phone use.
- **Built-in phrases** (greeting, disclosure, transfer) exist in English, German, French,
  Italian and Spanish; other voice languages fall back to English. Have a native speaker review
  them before launch.

## WhatsApp (Twilio)

1. Set up a WhatsApp sender in Twilio. This requires Meta approval of the business; the Twilio
   sandbox is fine for testing.
2. Messaging webhook: `POST https://YOUR-APP-DOMAIN/api/channels/twilio/whatsapp`.
3. Assign the number:
   ```sql
   select public.assign_channel_address('<business uuid>', 'whatsapp', '+355691234567');
   ```
4. Enable it in Channels → WhatsApp. Messages are answered by the Reservation Assistant, which
   can book; bookings are marked "AI WhatsApp assistant".

Phone numbers are stored only as a keyed hash.

## Verification status

Signature checks, routing, TwiML and widget headers are tested automatically. Real calls and
WhatsApp messages need a Twilio account, a public HTTPS URL and the keys above, and have not
been placed yet.
