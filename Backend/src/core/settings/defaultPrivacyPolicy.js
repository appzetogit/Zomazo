/**
 * The starting Privacy Policy for the platform, written for every service it
 * runs: food, groceries (Quick), medicines, rides and parcels, and home services,
 * and for the partners on the other side of each.
 *
 * Seeded once into Master settings -> Legal pages (platform_profile.legal.privacy)
 * by scripts/seed-privacy-policy.mjs, only where that page is empty, so every app
 * shows it and an admin can edit it from then on. Nothing here names a legal
 * entity, address or grievance officer: those are the operator's to fill in, and
 * a made-up one in a public policy is worse than none.
 */

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function defaultPrivacyPolicyHtml({ brand = 'Zomazo', email = 'zomazo.in@gmail.com', updated = new Date() } = {}) {
  const b = esc(brand);
  const em = esc(email || 'zomazo.in@gmail.com');
  const date = updated.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const contactLine = `by email at <a href="mailto:${em}">${em}</a>, or through <strong>Help &amp; Support</strong> in the app`;

  return `
<h1>Privacy Policy</h1>
<p><strong>Effective Date / Last Updated:</strong> ${date}</p>

<p>${b} ("we", "us", "our") is committed to protecting your privacy. This Privacy Policy applies to the ${b} mobile applications (iOS and Android), web applications, and related services (collectively, the "Platform"), covering all verticals including food delivery, quick commerce groceries, pharmacy and medical orders, rides and parcel logistics, and home services, as well as partner apps used by restaurants, sellers, pharmacies, delivery partners, drivers, and service professionals.</p>

<p>This policy explains how we collect, use, process, share, retain, and protect your personal data, and details your legal rights under applicable laws, including the <strong>Digital Personal Data Protection Act, 2023 (DPDP Act)</strong>, the <strong>Information Technology Act, 2000</strong>, the <strong>Apple App Store Review Guidelines (Guideline 5.1.1)</strong>, and the <strong>Google Play Developer Program Policies</strong>.</p>

<p>By creating an account, downloading, or using the Platform, you consent to the collection and practices described in this policy. If you do not agree with any part of this policy, please do not use our services.</p>

<hr />

<h3>1. Data Controller Information</h3>
<p>The primary entity responsible for the processing of your personal data is <strong>${b}</strong>. For any privacy-related inquiries, requests, or complaints, you can contact our Data Protection and Grievance Officer directly at <a href="mailto:${em}">${em}</a>.</p>

<h3>2. Information We Collect</h3>
<p>We collect only the personal information necessary to deliver, secure, and improve our services:</p>

<p><strong>A. Account &amp; Profile Details:</strong> Your mobile phone number (verified via secure One-Time Password / OTP), full name, email address (${em}), and optional demographic information such as date of birth, gender, and profile photo. A single user profile provides seamless access across all services on the Platform.</p>

<p><strong>B. Geolocation Data (Foreground &amp; Background):</strong></p>
<ul>
  <li><em>Customer Applications:</em> We collect your precise device location only while the app is in foreground use, with your explicit permission, to detect nearby restaurants and merchants, check service availability, calculate delivery fees, and show live order or ride status.</li>
  <li><em>Delivery Partner &amp; Driver Applications (Background Location):</em> For delivery partners and drivers, location data is collected continuously in the background (even when the app is closed or not in active view) while you are toggled "Online" or engaged in an active order/ride delivery. This is strictly necessary to assign nearby orders, provide turn-by-turn navigation, calculate accurate trip mileage, and provide customers with live real-time tracking for safety. Background tracking terminates immediately when you toggle your status to "Offline".</li>
</ul>

<p><strong>C. Orders, Bookings &amp; Transactions:</strong> Items ordered, merchant details, pickup/delivery addresses, timestamps, ride routes, special instructions, invoices, and historical order interactions.</p>

<p><strong>D. Prescription &amp; Health Information (Pharmacy Orders):</strong> Doctor prescriptions uploaded for ordering scheduled or prescription medicines. We treat medical prescriptions as sensitive personal data. They are encrypted and shared strictly with the licensed partner pharmacy and verified dispensing pharmacist fulfilling your order, in compliance with applicable pharmacy regulations.</p>

<p><strong>E. Payments &amp; Financial Information:</strong> All payments are processed through RBI-authorized, PCI-DSS Level 1 compliant payment partners (including Razorpay). We do <strong>not</strong> collect, process, or store your credit/debit card numbers, CVVs, net banking credentials, or UPI PINs. We only store payment status confirmations, transaction identifiers, and your ${b} internal wallet balance for refunds, cashback, and referral credits.</p>

<p><strong>F. Device, Technical &amp; Diagnostic Data:</strong> Device model, operating system and version, unique device identifiers, IP address, connection type, push notification tokens (Firebase Cloud Messaging), crash logs, and diagnostic performance metrics to ensure app stability and prevent fraud.</p>

<p><strong>G. Customer Support Communications:</strong> Messages, feedback, photos, and voice notes exchanged with our customer support team for dispute resolution.</p>

<p><strong>H. Partner Onboarding Documents:</strong> For merchant, delivery, and driver partners, we collect statutory KYC documentation (such as Aadhaar, PAN, driving licence, vehicle registration, FSSAI licence, drug licence, and GSTIN) and bank account / UPI details for payouts.</p>

<h3>3. How We Use Your Information</h3>
<ul>
  <li>To authenticate your identity, create and maintain your account, and prevent unauthorized access.</li>
  <li>To process, fulfill, and deliver food, grocery, medicine orders, taxi rides, and home services.</li>
  <li>To process transactions, refunds, cancellations, and partner earnings payouts.</li>
  <li>To send transactional push notifications, SMS, and emails regarding order status, driver arrival, and account security.</li>
  <li>To provide responsive customer support and investigate complaints or safety incidents.</li>
  <li>To detect, prevent, and mitigate fraud, spam, illegal activities, and terms violations.</li>
  <li>To comply with legal, tax, accounting, and regulatory obligations under Indian law.</li>
</ul>

<h3>4. Third-Party Disclosures &amp; Sub-Processors</h3>
<p>We do <strong>not</strong> sell, rent, or trade your personal data to advertisers or third parties. We share data only with trusted partners and service providers under strict data processing agreements:</p>
<ul>
  <li><strong>Fulfilling Partners:</strong> Restaurants, grocery merchants, licensed pharmacies, delivery riders, drivers, or service technicians receive only the details needed to prepare and deliver your order (e.g. name, delivery address, masked contact number).</li>
  <li><strong>Payment Gateways:</strong> Razorpay Software Private Limited for secure payment processing.</li>
  <li><strong>Mapping &amp; Geocoding:</strong> Google Maps Platform for route calculation, distance, and location search.</li>
  <li><strong>Cloud Infrastructure &amp; Push Notifications:</strong> Google Cloud Platform and Firebase (FCM) for backend hosting and real-time push alerts.</li>
  <li><strong>Telephony &amp; SMS:</strong> Authorized SMS gateways for delivering OTPs and transactional updates.</li>
  <li><strong>Law Enforcement &amp; Regulatory Authorities:</strong> When strictly mandated by applicable law, court order, or formal investigation.</li>
</ul>

<h3>5. Data Retention &amp; Storage</h3>
<p>We retain your personal data for as long as your account is active and as necessary to fulfill the purposes outlined in this policy. In accordance with statutory Indian financial, tax, and accounting laws (including the Companies Act and GST laws), transaction records, invoices, and dispute resolution records are securely archived for up to 8 years. When personal data is no longer needed, it is deleted or permanently anonymized.</p>

<h3>6. Account Deletion &amp; Data Erasure (Apple App Store &amp; Google Play Compliance)</h3>
<p>In full compliance with <strong>Apple App Store Guideline 5.1.1(v)</strong> and <strong>Google Play Data Safety</strong> requirements, we provide an easy, transparent, and permanent method for you to delete your account and all associated personal data:</p>
<ul>
  <li><strong>In-App Deletion:</strong> You can initiate account deletion directly within the mobile application at any time by navigating to: <code>Account / Profile &rarr; Settings &rarr; Delete Account</code>.</li>
  <li><strong>Email Deletion Request:</strong> You may also submit an account and data erasure request at any time by emailing our Grievance Officer at <a href="mailto:${em}">${em}</a> with the subject line <em>"Account Deletion Request"</em> and specifying your registered mobile number.</li>
</ul>
<p>Upon verification of your request, your personal credentials, identity data, saved addresses, device tokens, and customer history will be permanently deleted or irreversibly anonymized within <strong>30 days</strong>. Any remaining balance in your ${b} wallet should be redeemed prior to account closure. Statutorily required tax invoices and financial logs are archived strictly as required by applicable laws.</p>

<h3>7. Your Rights &amp; Choices</h3>
<p>Under the DPDP Act and consumer privacy regulations, you have the right to:</p>
<ul>
  <li><strong>Access &amp; Review:</strong> Request a copy of the personal data we maintain about you.</li>
  <li><strong>Correction &amp; Updates:</strong> Correct or update inaccurate data directly within the app profile.</li>
  <li><strong>Withdrawal of Consent:</strong> Withdraw consent for non-essential communications (such as marketing push notifications) at any time.</li>
  <li><strong>Grievance Redressal:</strong> File a complaint with our Grievance Officer or the Data Protection Board of India.</li>
</ul>
<p>To exercise any of these rights, contact us ${contactLine}. We will verify your identity and respond promptly within 30 days.</p>

<h3>8. Children's Privacy</h3>
<p>The Platform is strictly directed towards individuals aged 18 and older. We do not knowingly solicit or collect personal information from children under 18. If a parent or legal guardian becomes aware that a minor has created an account or shared personal information with us, please contact us immediately at <a href="mailto:${em}">${em}</a>, and we will promptly delete such information from our records.</p>

<h3>9. Security Measures</h3>
<p>We employ high-grade technical and organizational security controls, including 256-bit SSL/TLS encryption for all data in transit, firewalls, database encryption at rest, and strict role-based access controls. While we take every reasonable measure to protect your data, please ensure you keep your mobile phone and verification OTPs confidential.</p>

<h3>10. Changes to This Privacy Policy</h3>
<p>We may update this policy periodically to reflect evolving legal standards or Platform updates. Any changes will be posted here with an updated revision date. In case of material changes, we will provide prominent notice via in-app alert or push notification before the changes take effect.</p>

<h3>11. Contact &amp; Grievance Redressal Officer</h3>
<p>In accordance with the Information Technology Act, 2000 and the Rules made thereunder, and the Digital Personal Data Protection Act, 2023, the contact details for privacy inquiries and grievances are:</p>
<p>
  <strong>Grievance Officer:</strong> Grievance Redressal Desk<br />
  <strong>Organization:</strong> ${b}<br />
  <strong>Official Email:</strong> <a href="mailto:${em}">${em}</a><br />
  <strong>Official Website:</strong> <a href="https://zomazo.in" target="_blank" rel="noopener noreferrer">https://zomazo.in</a><br />
  <strong>In-App Support:</strong> Help &amp; Support section
</p>
<p>All grievances are acknowledged within 48 hours and resolved within 30 days of receipt.</p>
`.trim();
}
