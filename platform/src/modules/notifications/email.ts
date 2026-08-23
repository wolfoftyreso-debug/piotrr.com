import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Single EmailProvider interface (Section 3). Amazon SES (eu-north-1) is the
 * first real adapter; the console adapter is used in development and tests.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      "email (console provider)",
    );
  }
}

class SesEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    // Lazy import keeps the SDK out of the dev/test path.
    const { SESv2Client, SendEmailCommand } = await import(
      "@aws-sdk/client-sesv2"
    );
    const client = new SESv2Client({ region: env.S3_REGION });
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: env.EMAIL_FROM,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject },
            Body: {
              Text: { Data: message.text },
              ...(message.html ? { Html: { Data: message.html } } : {}),
            },
          },
        },
      }),
    );
  }
}

class SmtpEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    if (!env.SMTP_HOST) {
      throw new Error("EMAIL_PROVIDER=smtp requires SMTP_HOST to be set");
    }
    const { sendSmtp } = await import("./smtp");
    await sendSmtp(
      {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        requireTls: env.SMTP_REQUIRE_TLS,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
      },
      { from: env.EMAIL_FROM, ...message },
    );
  }
}

export function emailProvider(): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case "ses":
      return new SesEmailProvider();
    case "smtp":
      return new SmtpEmailProvider();
    default:
      return new ConsoleEmailProvider();
  }
}
