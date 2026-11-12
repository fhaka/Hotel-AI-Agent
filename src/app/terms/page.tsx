import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { legalInfo } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service", description: "Terms for using HotelAI." };

export default function TermsPage() {
  const { company, email } = legalInfo();
  return (
    <LegalPage title="Terms of Service" updated="12 November 2026">
      <p>
        These terms are a contract between {company} (&quot;HotelAI&quot;) and the business that creates a workspace
        (&quot;Customer&quot;). The person who accepts them confirms they may bind that business. HotelAI is a business-to-business
        service.
      </p>

      <h2>1. The service</h2>
      <p>
        HotelAI provides AI agents (website chat, reservation assistant and, on eligible plans, phone and WhatsApp), a knowledge base,
        a reservation system and automations. Features depend on the plan shown on the pricing page.
      </p>

      <h2>2. Free trial</h2>
      <p>
        Each person may start one free trial of 7 days. It begins when the workspace is created, needs no payment card and ends
        automatically. Trial limits are shown in the app.
      </p>

      <h2>3. Subscriptions and payment</h2>
      <ul>
        <li>Paid plans are billed monthly or yearly in advance by our reseller and merchant of record, Paddle, whose buyer terms also apply to the purchase.</li>
        <li>Subscriptions renew automatically until canceled. You can cancel at any time in the app; access continues until the end of the paid period.</li>
        <li>Plan changes are prorated by Paddle. Usage limits reset with each billing period; unused allowance does not carry over.</li>
        <li>If a payment fails, the service continues while Paddle retries; it stops if the subscription ends unpaid.</li>
      </ul>

      <h2>4. Customer responsibilities</h2>
      <ul>
        <li>Keep the information the AI uses (prices, policies, availability) accurate. The AI answers from that information.</li>
        <li>Tell guests about your use of HotelAI in your own privacy notice, and have a lawful basis for guest data you enter.</li>
        <li>Review bookings and hand-overs; you remain responsible for your contracts with guests.</li>
        <li>Do not use HotelAI for unlawful content, spam, or medical, legal or financial advice to individuals. For clinics, the AI may only handle administrative communication; it must not diagnose, prescribe or give individual medical advice.</li>
        <li>Keep sign-in details secret and give team roles carefully.</li>
      </ul>

      <h2>5. AI output</h2>
      <p>
        AI replies are generated automatically and can be wrong. HotelAI limits what the AI may do (for example, it can only book
        through the reservation engine after the guest confirms, and only reports a booking after it is saved), but it does not
        guarantee that every answer is correct or complete.
      </p>

      <h2>6. Data</h2>
      <p>
        Customer owns its data. HotelAI processes guest data as processor under the <a href="/dpa">Data Processing Terms</a>, which
        form part of these terms. Customer can export or delete its data at any time.
      </p>

      <h2>7. Availability and changes</h2>
      <p>
        We aim for high availability but do not promise uninterrupted service. We may suspend a workspace for non-payment, abuse,
        security risk or legal reasons, and will tell the owner why where we are allowed to.
      </p>

      <h2>8. Liability</h2>
      <p>
        To the extent permitted by law, each party&apos;s total liability is limited to the fees paid in the 12 months before the
        claim, and neither party is liable for indirect or consequential loss. Nothing limits liability that cannot be limited by law.
      </p>

      <h2>9. Term and termination</h2>
      <p>
        Customer may stop at any time by canceling and deleting the workspace. We may end these terms with 30 days&apos; notice, or
        immediately for serious breach.
      </p>

      <h2>10. Law and contact</h2>
      <p>
        These terms are governed by the law of the country of {company}&apos;s registered office, unless mandatory law says
        otherwise. Questions: <a href={`mailto:${email}`}>{email}</a>.
      </p>
    </LegalPage>
  );
}
