import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { legalInfo, SUBPROCESSORS } from "@/lib/legal";

export const metadata: Metadata = { title: "Data Processing Terms", description: "How HotelAI processes guest data on behalf of hotels (GDPR Art. 28)." };

export default function DpaPage() {
  const { company, email } = legalInfo();
  return (
    <LegalPage title="Data Processing Terms" updated="12 November 2026">
      <p>
        These terms apply when {company} (&quot;Processor&quot;) processes personal data on behalf of a HotelAI customer
        (&quot;Controller&quot;), as required by Article 28 GDPR and comparable laws. They form part of the Terms of Service.
      </p>

      <h2>1. Subject and duration</h2>
      <ul>
        <li><strong>Purpose:</strong> answering guests, handling reservations, sending notifications and storing records for the Controller.</li>
        <li><strong>Data subjects:</strong> the Controller&apos;s guests, enquirers and callers; the Controller&apos;s staff.</li>
        <li><strong>Data:</strong> names, contact details, stay details, special requests, chat/WhatsApp messages, call transcripts, hashed visitor and phone references.</li>
        <li><strong>Special categories:</strong> not intended. The Controller should not ask the AI to collect health or other sensitive data.</li>
        <li><strong>Duration:</strong> while the Controller&apos;s workspace exists, then deletion (see §6).</li>
      </ul>

      <h2>2. Instructions</h2>
      <p>
        The Processor processes data only on the Controller&apos;s documented instructions — the configuration of the workspace and
        these terms — unless law requires otherwise, in which case it informs the Controller where permitted.
      </p>

      <h2>3. Confidentiality and security</h2>
      <ul>
        <li>Personnel with access are bound to confidentiality; operator access is limited to platform administrators and logged.</li>
        <li>Measures: encryption in transit and at rest; tenant isolation by database row-level security; role-based access; signed webhooks; rate limiting; secrets only on the server; audit logging; backups by the database provider.</li>
      </ul>

      <h2>4. Sub-processors</h2>
      <p>The Controller authorises these sub-processors. We will announce changes at least 30 days in advance; the Controller may object.</p>
      <table>
        <thead><tr><th>Sub-processor</th><th>Purpose</th><th>Data</th><th>Location</th></tr></thead>
        <tbody>
          {SUBPROCESSORS.map((s) => (
            <tr key={s.name}><td>{s.name}</td><td>{s.purpose}</td><td>{s.data}</td><td>{s.location}</td></tr>
          ))}
        </tbody>
      </table>
      <p>International transfers use adequacy decisions or Standard Contractual Clauses.</p>

      <h2>5. Assistance</h2>
      <p>
        The Processor helps the Controller answer data-subject requests (export, correction, erasure tools are in the app), and with
        security, impact assessments and authority consultations where needed. It notifies the Controller of a personal data breach
        without undue delay and at the latest within 48 hours of becoming aware of it.
      </p>

      <h2>6. Deletion and return</h2>
      <p>
        The Controller can export all data and delete the workspace at any time. Deleted data is removed from the live database
        immediately and from backups when they expire (at most 30 days later, depending on the database provider&apos;s backup cycle).
      </p>

      <h2>7. Audits</h2>
      <p>
        The Processor makes available the information needed to show compliance and allows reasonable audits, on 30 days&apos;
        notice, at the Controller&apos;s cost, normally by written questionnaire. Contact: <a href={`mailto:${email}`}>{email}</a>.
      </p>
    </LegalPage>
  );
}
