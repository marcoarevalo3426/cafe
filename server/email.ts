import nodemailer, { type Transporter } from "nodemailer";
import { lookup } from "node:dns/promises";
export function emailConfiguration(
  env: Record<string, string | undefined> = process.env,
) {
  const from = env.EMAIL_FROM ?? env.SMTP_USER;
  const transport = env.EMAIL_TRANSPORT ?? (env.SMTP_HOST ? "smtp" : "resend");
  if (transport === "resend") {
    if (!from || !env.RESEND_API_KEY) return null;
    return { transport: "resend", from, apiKey: env.RESEND_API_KEY } as const;
  }
  if (transport !== "smtp")
    throw new Error("EMAIL_TRANSPORT must be smtp or resend.");
  if (!from || !env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD)
    return null;
  const port = Number(env.SMTP_PORT ?? 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid SMTP_PORT.");
  if (![465, 587].includes(port))
    throw new Error("SMTP_PORT must use TLS on 465 or STARTTLS on 587.");
  return {
    transport: "smtp",
    from,
    forceIPv4: env.SMTP_FORCE_IPV4 === "1",
    options: {
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: true,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      tls: { rejectUnauthorized: true },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    },
  } as const;
}
let transporter: Transporter | undefined;
let transportCreated = 0;
async function smtpTransport(
  config: Extract<
    NonNullable<ReturnType<typeof emailConfiguration>>,
    { transport: "smtp" }
  >,
) {
  if (!transporter || Date.now() - transportCreated > 300000) {
    const address = config.forceIPv4
      ? (await lookup(config.options.host, { family: 4 })).address
      : config.options.host;
    transporter = nodemailer.createTransport({
      ...config.options,
      host: address,
      tls: { ...config.options.tls, servername: config.options.host },
    });
    transportCreated = Date.now();
  }
  return transporter;
}
export async function verifyEmailTransport() {
  const config = emailConfiguration();
  if (!config) throw new Error("Email delivery is not configured.");
  if (config.transport !== "smtp")
    throw new Error("SMTP verification requires EMAIL_TRANSPORT=smtp.");
  await (await smtpTransport(config)).verify();
}
export async function sendEmail(job: {
  id: string;
  to: string;
  subject: string;
  message: string;
  html?: string;
}) {
  const config = emailConfiguration();
  if (!config) throw new Error("Email delivery is not configured.");
  if (config.transport === "smtp") {
    await (
      await smtpTransport(config)
    ).sendMail({
      from: config.from,
      to: job.to,
      subject: job.subject,
      text: job.message,
      ...(job.html ? { html: job.html } : {}),
      messageId: `<${job.id}@${config.from.split("@").pop()}>`,
    });
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": job.id,
    },
    body: JSON.stringify({
      from: config.from,
      to: job.to,
      subject: job.subject,
      text: job.message,
      ...(job.html ? { html: job.html } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Email provider rejected delivery.");
}
