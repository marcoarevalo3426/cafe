# Validation

Executed during implementation on 13 November 2026 (Australia/Melbourne):

- TypeScript strict check passed.
- Production Webpack build passed.
- Expo dependency compatibility check passed.
- iOS and Android Hermes JavaScript exports passed, with local Inter fonts bundled.
- 23 isolated domain/API tests passed (see final run).
- Local in-app browser: invalid email message; six-digit email code paste; owner verification and restored session; completing an order; viewing completed order history; drawer navigation; menu-template layout; voucher-generation validation/organisation/summary steps; successful generation of two test vouchers after approval; customer login; live owner-generated menu; item variation and note selection; combined voucher balance and cart total.

Browser testing caught and fixed stale session state routing after verification, root container height, radio accessibility state, voucher-table checkbox labels, divider scaling, and the back-arrow rotation. Existing local test data is not committed.

Automatic approval review initially stopped the browser cash-received submission. After explicit user approval, the test generated two $10 vouchers for the demo organisation; the UI displayed six total vouchers and a success confirmation. No real payment or email occurred.

Not executed: live email delivery, live/test Stripe provider checkout, real Apple Pay/Google Pay, APNs/FCM delivery, Expo OTA delivery to installed binaries, signed iOS/Android builds, and Docker image execution. These need external credentials, developer accounts/devices, or Docker (not available in the execution environment). The integration code and deployment configuration are included.

The supplied Figma contains mobile frames. Desktop behavior is adapted with a persistent navigation column at 1000 CSS pixels and wider content bounds. Customer item/cart, organisation and management pages extend the existing visual conventions because complete matching Figma frames/JPG references were not supplied.

Responsive verification used an isolated local iframe harness at 320, 402 and 1280 CSS pixels. Narrow layouts stack cafe tiles and retain mobile navigation; desktop layouts show the persistent navigation column. The harness is not part of the product.

The validity display has a regression test for the exclusive end-of-month UTC boundary, including year rollover.

Local Testing mode update: signup and management share a four-role demo account picker. Added HTTP coverage for all roles and native session tokens, production/demo-disabled rejection, public-host and remote-peer rejection, forged forwarding headers, and rejection of local test sessions on public requests.

Browser verification confirmed the Testing mode button on signup, direct demo Admin login, the button on management, switching from Admin to Customer, and logout back to signup. Webpack and iOS/Android bundle exports passed for this change.


## AWS and MySQL update — 14 November 2026

- Deployed Amplify app `d2kzvdmp17kwpy`, branch `test`, in NEP account `375033595717`, Sydney. Final website publication job 4 reached `SUCCEED`; the `cafe-test` backend stack reached `UPDATE_COMPLETE`.
- Live URL: https://test.d2kzvdmp17kwpy.amplifyapp.com
- All 32 tests passed against a disposable real DynamoDB table; the table was deleted afterward. This includes large UTF-8 collections spanning multiple chunks, unique keys, concurrent increments, nested rollback, simultaneous OTP redemption, and the API Gateway event regression below.
- MySQL 8.4 compatibility passed 31 tests against isolated test databases; the DynamoDB-specific chunk test was skipped in that mode. The legacy local SQLite source was migrated read-only into a fresh local MySQL database earlier in the migration; it was not copied to AWS.
- Strict TypeScript, production web build, compiled Node server, AWS Lambda bundle, and both iOS/Android Hermes exports passed.
- The deployment smoke check exposed body-parser ordering after asynchronous rate limiting on Lambda. JSON parsing now runs first, while Stripe keeps its dedicated raw-body route. The new regression completes signup, base64 request decoding, verification, session-cookie handling, and role selection using API Gateway v2 events.
- Public Amplify checks passed: health, same-origin API proxy, guest bootstrap, JSON validation, foreign-origin rejection, protected-admin rejection, public Testing mode rejection, secure HttpOnly SameSite cookie, cookie forwarding, role selection, saved settings, and logout. Only synthetic smoke-test records were created; those records were removed. No email or payment was sent by these checks.
- SMTP authentication passed from the deployed Lambda using the encrypted SSM configuration, certificate-verified TLS, and IPv4. Email delivery to an actual inbox was not exercised.
- Browser checks confirmed the live signup screen, invalid-email message, and absence of Testing mode online. Screenshot: [live signup](aws-live-signup.png).
- Frontend scan found no supplied SMTP password; the temporary private credential upload file was removed. Secrets remain outside Git and frontend assets.
- CloudFormation schema validation passed with cfn-lint and AWS service validation. cfn-guard compliance rules were unavailable; they were not evaluated.

See [AWS test deployment](AWS-TEST.md) for the usage-based cost example, resource layout, test-database limits, redeployment, and complete cleanup of retained storage.


## Account choice, database prefix and verification email — 14 November 2026

- Both allowlisted emails now receive Cafe Owner, Customer and Admin choices after successful email verification. Session-scoped selection persists across refreshes; new logins and legacy sessions require a choice. Switch account is available only for those authenticated emails. Owner selection reuses the same cafe and preserves its menu.
- Customer/owner selections have no admin API access. Ordinary emails cannot see or select Admin, including by forging a request email, changing a role field, or using local Testing mode. The former demo Admin shortcut was removed to enforce the two-email rule in local testing as well.
- All 37 tests passed against an isolated real DynamoDB table, which was deleted afterward. MySQL 8.4 passed 36 tests; the DynamoDB-specific chunk test was skipped in that mode. TypeScript, production web build and iOS/Android Hermes exports passed.
- Browser verification used an isolated in-memory local fixture: verified the allowed email, viewed all three choices, selected Cafe Owner, switched to Admin/management, then Customer. No real email or cloud user account was used. Screenshot: [account chooser](account-chooser.png).
- Verification messages now use the exact subject **Verify your email address**. The HTML email presents the six-digit code prominently, preserves leading zeros, shows the three-minute expiry and includes a plain-text fallback. Tests verify the subject and matching HTML/text code stored in the outbox. Visual preview used the dummy code 012345: [email preview](verification-email.png).
- The active table is now **nep-cafe-test-data**. Migration briefly paused the test API/worker, copied all three stored items, verified byte-for-byte fingerprints, switched both Lambda environments, and restored previous concurrency and schedule settings. The original table remains an inactive rollback copy. Runtime permissions now reference only the active table.

- Final Amplify publication job 5 reached `SUCCEED`; the stack reached `UPDATE_COMPLETE`. Public verification, secure cookie forwarding, Customer selection, settings and logout passed on the renamed table using a synthetic account, which was removed afterward. The ordinary account received no Admin choices and a forged admin request was rejected. SMTP authentication passed from the deployed worker without sending email.


## SMTP endpoint update — 14 November 2026

- Updated the encrypted live SMTP configuration and private deployment settings to the supplied AWS Mail Manager endpoint on port 587 with required STARTTLS and sender `marevalo@nepgroup.com`.
- Authentication succeeded locally and from the refreshed AWS worker. Certificate validation stayed enabled. The live SecureString was compared against the supplied settings without logging credentials. No test email was sent.
- Updated `.env.example` with the endpoint, port and sender; username/password remain blank. Credentials are excluded from Git and frontend assets.


## Optional voucher email, test sign-in and NEP name — 14 November 2026

- Product name is **NEP Cafe Vouchers** in the website title, signup screen, mobile configuration, loading/dialog branding and verification email. Expo config resolved the requested display name; iOS and Android exports passed.
- All 42 tests passed against a disposable real DynamoDB table, which was deleted afterward. MySQL passed 41 tests; the DynamoDB-specific chunk test was skipped. TypeScript, production web build and infrastructure schema validation passed.
- Owner/admin voucher issuance accepts omitted, blank or whitespace organisation emails. It creates vouchers and distinct organisations without empty user accounts or outgoing email jobs. Provided email addresses retain validation, invitation and receipt behavior. Existing organisations without emails can receive more vouchers.
- Payment defaults to Card / Apple Pay / Google Pay. One state value and a labelled radio group enforce one selected option; the API rejects arrays, combined and invalid payment values. Cash still requires receipt confirmation. Browser checks confirmed blank-email progression and switching between Card and Cash with exactly one selected radio. [Payment selection](voucher-payment-selection.png).
- The temporary bypass applies only to the two allowlisted addresses, behind the explicit test-stage setting. Their sign-in opens Choose account without an OTP or email job. Other accounts retain verification, spoofed request flags are ignored, and bypass sessions become invalid after the setting is disabled. The default configuration is disabled. This behavior is covered through production-mode API Gateway event tests.
- Browser checks in an isolated local demo confirmed the new name and direct transition from the allowed email to Choose account. No real email, payment or online voucher was generated during validation.

- Final Amplify job 7 reached `SUCCEED`, and the backend reached `UPDATE_COMPLETE` with `APP_STAGE=test` and `TestEmailSignIn=allowlisted`. The live website shows NEP Cafe Vouchers and the approved test email opened Choose account without a code. [Renamed sign-in screen](nep-cafe-vouchers-signin.png), [live chooser](allowed-test-signin.png). The browser was left at the chooser for the user.
- The ordinary-account public smoke check passed secure verification/session cookies, role selection, settings, logout and Admin rejection. Its synthetic records were removed. No live voucher or payment was created.


## Local cart payment defaults — 14 November 2026

- The cart now defaults to Voucher for positive usable credit and Card / Apple Pay / Google Pay at zero. The radio group has exactly one selected method, the zero-value voucher option is disabled, and customers can choose Card even when vouchers cover the order.
- Explicit choices survive balance refreshes, and changing cafes uses that cafe's default. Unrelated, expired, empty and externally reserved vouchers do not count toward available credit. This checkout's own reserved credit remains visible while payment is pending.
- A voucher shortfall still uses the available voucher amount and sends the remainder to secure card/wallet checkout; the UI explains the remaining amount.
- Local `npm run check` passed: 44 tests passed and the DynamoDB-only chunk integration test was skipped. TypeScript and production Webpack passed. iOS and Android Hermes exports passed.
- Isolated local browser checks passed: $20 credit defaults to Voucher; choosing Card deselects Voucher and restores the full card amount; switching back restores voucher credit; a $20.80 cart applies $20 vouchers and displays the $0.80 shortfall; the separate $0 fixture defaults to Card with Voucher disabled. No order, email or payment was submitted.
- Screenshots: [positive credit](cart-default-voucher.png), [zero credit](cart-default-card.png). All changes were made and validated locally before the GitHub push. No AWS deployment was performed for this update.
