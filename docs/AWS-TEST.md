# AWS test deployment

Product name: **NEP Cafe Vouchers**.

Website: https://test.d2kzvdmp17kwpy.amplifyapp.com

Amplify app name: `nep-cafe-voucher-test`.

Account: `375033595717` (NEP). Region: `ap-southeast-2` (Sydney). Stack: `cafe-test`; private artifact stack: `cafe-test-artifacts`. Active DynamoDB table: `nep-cafe-test-data`.

## Design and cost

Amplify serves the static React Native Web build over HTTPS. Its `/api/*` and `/health` rules proxy to an API Gateway HTTP API and an on-demand, ARM Lambda running Express. Requests use the same-origin HttpOnly cookie. The database is DynamoDB Standard, on demand, encrypted at rest. No RDS instance, VPC, NAT gateway, load balancer, provisioned Lambda concurrency, or Amplify WAF subscription is created. Website builds run locally and are uploaded through Amplify's signed deployment URL.

DynamoDB suits the app's existing ID-based record collections and small test workload. RDS MySQL remains an alternative when relational querying or a larger dataset becomes necessary; the MySQL adapter is retained. The AWS test does not connect to the previous shared-hosting database and supports an explicitly authorised business-data replacement from the local MySQL database. The initial AWS table was migrated to `nep-cafe-test-data`: the API/worker were paused, all three stored items were copied and verified byte-for-byte, both runtime configurations switched, and concurrency/scheduling restored. The original `cafe-test-Data-JW0WI6V05QUL` is retained as an inactive rollback copy; runtime IAM access is scoped to the new table. Both tables remain managed by the same stack and retained on deletion.

Plan around **US$1–5/month for light testing**, depending on actual usage; this is an estimate, not a spending cap. Free-tier eligibility and credits are not assumed. Current AWS Price List rates retrieved on 14 November 2026 produce a US$0.4669/month core-service subtotal for this illustrative workload:

| Assumption | Monthly USD |
| --- | ---: |
| Amplify: 1 GB served, 0.05 GB stored | 0.15115 |
| HTTP API: 10,000 requests | 0.01290 |
| Lambda: 10,000 API calls at 0.2 s and 43,200 worker polls at 0.5 s, 256 MB | 0.08931 |
| DynamoDB: 1 million read units and 100,000 write units | 0.21350 |

The subtotal excludes database/artifact storage, CloudWatch logs, other network transfer, SMTP-provider charges, taxes, and extra traffic. The larger planning allowance covers small ancillary usage, not heavy load. DynamoDB snapshot size changes read/write consumption. Sources: [Amplify pricing](https://aws.amazon.com/amplify/pricing/), [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/), [Lambda pricing](https://aws.amazon.com/lambda/pricing/), [API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/). Exact rates were calculated from the AWS Price List API, not free-tier examples.

API Gateway throttles to 5 requests/second with a burst of 10. API reserved concurrency is 3; worker concurrency is 1. DynamoDB has maximum on-demand read/write throughput settings of 1,000 units/second. These are service throttles, not hard billing caps. Logs expire after seven days.

## Sign in and test

During the requested test phase, entering `marco.arevalo3426@gmail.com` or `marevalo@nepgroup.com` in the signup form opens **Choose account** without sending a code. All other emails still use the emailed six-digit code. This makes the two test accounts accessible to anyone who enters those addresses on the public test site; use only test data while enabled. The online application has `DEV_DEMO=0`; Testing mode and code previews are available only on the local development server. New owners start with an empty cafe and can add menu templates. The two allowlisted emails see Cafe Owner, Customer and Admin choices after sign-in, plus Switch account in navigation. The active role is scoped to each session. Selecting Customer or Cafe Owner removes admin permissions from that session. Other emails never receive the Admin option and cannot request it through the API or local Testing mode. Card payments remain unavailable until Stripe test credentials and a webhook are configured. Voucher generation now defaults to Card / Apple Pay / Google Pay, with one selectable payment option. Organisation roles, profiles, recipient directories and allocation endpoints are removed. Owner/admin generation goes directly from quantity/value/validity to payment review, assigning new vouchers to the generating account. Valid entered codes are assigned to the signed-in account and reflected in its wallet; expired, empty, reserved or wrong-cafe codes are rejected. Any enabled signed-in account can place a cafe order, regardless of its active Customer/Owner/Admin selection; management permissions remain scoped to the selected role. Cash requires explicit receipt confirmation.

The worker receives immediate dispatches after successful mutations and polls once per minute for retries. SMTP credentials are stored in the standard SecureString parameter `/cafe-test/config`; they are not in Amplify environment settings, frontend assets, Git, or this document. Verification messages use the subject **Verify your email address**, styled HTML with a prominent six-digit code, and a plain-text fallback. SMTP uses the authenticated AWS Mail Manager endpoint `az4s4n95v4x4.jd2m.mail-manager-smtp.amazonaws.com` on port 587, with required STARTTLS, certificate verification, IPv4, and sender `marevalo@nepgroup.com`. SMTP authentication was verified from Lambda without sending an email. Public session smoke tests used synthetic OTP/account records and removed them afterward.

## Restore email verification

The CloudFormation parameter `TestEmailSignIn` defaults to `disabled`. The current private `.env.hosting` explicitly sets `TEST_EMAIL_SIGN_IN=allowlisted`; Lambda additionally requires `APP_STAGE=test`. No request body or client flag can enable this feature. Set `TEST_EMAIL_SIGN_IN=disabled` in that private file and run `npm run deploy:aws` to restore normal verification. Sessions created by the bypass are rejected as soon as the setting is disabled. OTP-verified sessions are unaffected.

## Redeploy

Use Node 24+, AWS CLI, the NEP AWS profile, and the ignored `.env.hosting` file with SMTP settings. The script refuses to deploy to another account. It updates only the two Cafe stacks, `/cafe-test/config`, and this Amplify app.

```sh
npm ci
npm run typecheck
npm run deploy:aws
```

The script stores non-secret resource identifiers in ignored `.aws-deployment.json`. It builds the Lambda ZIP, uploads it to private encrypted S3, deploys CloudFormation, builds the frontend, and waits for Amplify publication to reach `SUCCEED`. It waits for active prior jobs before creating an upload.

```sh
aws amplify get-job --app-id d2kzvdmp17kwpy --branch-name test --job-id JOB_ID --region ap-southeast-2
```

`infra/aws-test.json` contains the runtime role policy: DynamoDB actions are scoped to this stack's table, SSM read access to its one configuration parameter, log writes to its two Lambda log groups, and invocation to its one outbox worker. There are no runtime static AWS access keys. Baseline IAM analysis was generated with:

```sh
uvx iam-policy-autopilot@latest generate-policies "$PWD/server/dynamodb.ts" "$PWD/server/lambda.ts" --region ap-southeast-2 --account 375033595717 --service-hints dynamodb ssm lambda --pretty
```

The analyser's wildcard resources were narrowed and unused replication/KMS grants removed. The default AWS-managed SSM key is used; no paid customer-managed KMS key is created.

## Database behavior and limits

The small-test DynamoDB adapter stores ordered collections in 300 KB binary chunks. Strong reads and revision validation create a consistent snapshot; conditional multi-item commits prevent concurrent lost updates. Failed writes and nested transactions roll back. Uniqueness checks run inside the same optimistic transaction. UTF-8 strings crossing chunk boundaries are reconstructed before parsing.

A commit is limited to 99 changed chunks plus its revision item and 3.5 MB of changed payload. Oversized operations fail with an explicit error before any data is written. The adapter reads full collections for compatibility with the existing domain layer and is intended for a small test dataset, not high-volume production traffic. SMTP delivery is at least once; provider failures are retried and stable message IDs help identify duplicates.

The same domain/API suite can run against a fresh DynamoDB table with isolated namespaces:

```sh
npm run test:dynamodb
```

This creates a uniquely named disposable table and deletes that table in a `finally` block. It never touches the deployed app table.

`AWS_REGION=ap-southeast-2 node --import tsx scripts/smoke-aws.ts` separately verifies the public proxy, secure session cookie, role selection, settings and logout with a uniquely named synthetic account. It seeds a test OTP directly, sends no email, never creates vouchers/payments, and removes only its own generated account/session/OTP records.

## Stop and remove the test

To reduce idle work while keeping the app/data, disable the `cafe-test` stack's EventBridge worker schedule. Sign-in email and notifications will stop until it is enabled again. Amplify and database storage remain billable.

For full removal, delete only `cafe-test` and `cafe-test-artifacts` after reviewing the data you want to keep. CloudFormation deliberately **retains** both the active and inactive rollback DynamoDB tables and the S3 artifact bucket. Export any wanted data, then explicitly delete those retained resources, all object versions in the artifact bucket, and `/cafe-test/config`. Retained data continues to incur storage costs. Do not delete unrelated NEP resources. No teardown was performed during deployment.

## Validation scope

Schema validation used `cfn-lint` and CloudFormation service validation. CloudFormation pre-deployment checks remained enabled. A standalone cfn-guard compliance rules evaluation was unavailable in this environment; no claim of compliance certification is made. Real Stripe transactions, device push delivery, app-store signing, and installed-device OTA are separate checks.

## Explicit local business-data replacement

Application code and schema/migration definitions are stored in GitHub. Database contents, local browser captures with redeemable voucher codes, credentials and backups are excluded from Git.

`server/migrate-accounts.ts` upgrades existing account records on startup. Former Organisation users become Customers, assigned voucher value/validity/reservations are preserved, and retired records are archived before removal.

For the explicitly authorised replacement of AWS test business data with the localhost:8080 snapshot:

```sh
AWS_PROFILE=default node --env-file=.env --import tsx scripts/replace-aws-test-data.ts --plan
AWS_PROFILE=default node --import tsx scripts/replace-aws-test-data.ts --backup
AWS_PROFILE=default node --env-file=.env --import tsx scripts/replace-aws-test-data.ts --replace
```

The script checks the NEP account, exact test table/app and local source database. It backs up the consistent AWS snapshot to a private encrypted S3 object before replacement. For replacement, the API and worker are briefly paused while in-flight calls finish. Business records are replaced atomically, every imported record is verified, and previous concurrency settings are restored. Failed verification restores the original records. Local pending provider payments block the operation.

Business data includes users, cafes, menus, templates, vouchers, orders, settings, feedback, generated build metadata and completed/cancelled checkout history. Local sessions, OTPs, pending checkouts, queued email/push jobs, logs and payment-provider credentials are not copied. Local voucher reservations are released in the copied snapshot, and existing online sessions are cleared, so users sign in again after replacement. The ignored `.aws-data-backup.json` and `.aws-data-replacement.json` contain counts and private backup locations.
