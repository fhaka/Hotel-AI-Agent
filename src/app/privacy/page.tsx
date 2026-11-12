import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { legalInfo, SUBPROCESSORS } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Notice", description: "How HotelAI handles personal data." };

export default function PrivacyPage() {
  const { company, email } = legalInfo();
  return (
    <LegalPage title="Privacy Notice" updated="12 November 2026">
      <p>
        This notice explains how {company} (&quot;HotelAI&quot;, &quot;we&quot;) handles personal data when you use our website and
        service. It is written to meet the EU/UK GDPR and comparable laws (for example Albania&apos;s Law No. 124/2024 on personal
        data protection).
      </p>

      <h2>1. Two roles</h2>
      <ul>
        <li><strong>Controller</strong> for our customers&apos; account data (people who sign up, team members, billing contacts) and our website.</li>
        <li><strong>Processor</strong> for data our customers put into HotelAI about <em>their</em> guests (reservations, guest details, chat and call transcripts). The hotel is the controller for that data; guests should contact the hotel first. Our <a href="/dpa">Data Processing Terms</a> apply.</li>
      </ul>

      <h2>2. What we collect and why</h2>
      <table>
        <thead><tr><th>Data</th><th>Purpose</th><th>Legal basis</th></tr></thead>
        <tbody>
          <tr><td>Name, email, password (stored as a hash by our auth provider)</td><td>Your account, sign-in, security emails</td><td>Contract</td></tr>
          <tr><td>Business details, team members and roles</td><td>Providing the workspace</td><td>Contract</td></tr>
          <tr><td>Plan, subscription status, invoices (via Paddle)</td><td>Billing and tax</td><td>Contract, legal obligation</td></tr>
          <tr><td>Usage counts (AI messages, tokens, voice minutes, emails)</td><td>Plan limits, billing, abuse prevention</td><td>Contract, legitimate interest</td></tr>
          <tr><td>Security logs (sign-ins, sensitive changes, hashed IP addresses for rate limits)</td><td>Security and fraud prevention</td><td>Legitimate interest</td></tr>
          <tr><td>Guest data entered by hotels or given to their AI agents</td><td>Processing on the hotel&apos;s instructions</td><td>The hotel&apos;s basis (we are processor)</td></tr>
        </tbody>
      </table>
      <p>We do not sell personal data and do not use it for advertising. We do not use analytics or advertising cookies.</p>

      <h2>3. AI agents</h2>
      <ul>
        <li>Guests are always told that they are talking to an AI assistant (chat and phone).</li>
        <li>Messages are sent to OpenAI to generate replies. Under OpenAI&apos;s API terms, API data is not used to train their models by default; we send it without storing it at OpenAI where the API allows (&quot;store: false&quot;).</li>
        <li>Phone calls are <strong>not recorded</strong>. The caller&apos;s speech is converted to text by Twilio, and the text transcript is kept like a chat. Callers hear this at the start of the call.</li>
        <li>The AI cannot make legally binding decisions about people. Bookings it makes follow the hotel&apos;s published rules and can be changed by hotel staff.</li>
      </ul>

      <h2>4. Who receives data</h2>
      <table>
        <thead><tr><th>Provider</th><th>Purpose</th><th>Location</th></tr></thead>
        <tbody>
          {SUBPROCESSORS.map((s) => (
            <tr key={s.name}><td>{s.name}</td><td>{s.purpose}</td><td>{s.location}</td></tr>
          ))}
        </tbody>
      </table>
      <p>Transfers outside the EEA/UK rely on adequacy decisions or the European Commission&apos;s Standard Contractual Clauses.</p>

      <h2>5. How long we keep data</h2>
      <ul>
        <li>Account and workspace data: while the account exists; deleted when the workspace is deleted.</li>
        <li>Guest conversations (chat, WhatsApp, call transcripts): 730 days, then deleted automatically. Staff test chats: 90 days.</li>
        <li>Email delivery log: 180 days. Security audit log: 2 years.</li>
        <li>Invoices and tax records: as required by tax law (kept by Paddle as merchant of record).</li>
      </ul>

      <h2>6. Your rights</h2>
      <p>
        You can ask for access, correction, deletion, restriction, portability, or object to processing based on legitimate interest.
        Workspace owners can export all workspace data and delete the workspace themselves under <em>Data &amp; privacy</em>. Email{" "}
        <a href={`mailto:${email}`}>{email}</a> for anything else; we answer within one month. You may also complain to your data
        protection authority (in Albania: the Information and Data Protection Commissioner).
      </p>

      <h2>7. Security</h2>
      <p>
        Data is encrypted in transit and at rest by our providers. Each business&apos;s data is isolated by database row-level
        security, staff access is role-based, and administrative actions are logged.
      </p>

      <h2>8. Cookies</h2>
      <p>
        We only use cookies that are necessary for the service: the sign-in session and your selected workspace. The payment page of
        Paddle may set its own necessary cookies during checkout.
      </p>

      <h2>9. Changes</h2>
      <p>We will announce material changes by email or in the app before they take effect.</p>
    </LegalPage>
  );
}
