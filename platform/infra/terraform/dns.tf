# Optional Route 53 records — only when the zone lives in this account.
# Both hostnames point at the node's EIP; Caddy terminates TLS per host.

resource "aws_route53_record" "app" {
  count   = var.route53_zone_id != "" && var.app_domain != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.app_domain
  type    = "A"
  ttl     = 300
  records = [aws_eip.node.public_ip]
}

resource "aws_route53_record" "files" {
  count   = var.route53_zone_id != "" && var.files_domain != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.files_domain
  type    = "A"
  ttl     = 300
  records = [aws_eip.node.public_ip]
}

# ---------------------------------------------------------------------------
# Mail authentication for the own relay (Appendix B: no SES, no mail SaaS).
#
# Verification emails and magic links are the login path — if they land in
# spam, suppliers cannot sign in. All three records must exist before the
# first production send.
#
# The DKIM keypair is generated on the relay (e.g. opendkim-genkey -s
# <selector> -d <domain>); paste the public half into mail_dkim_public_key
# as the raw base64 from the .txt file, without quotes or "p=".
# ---------------------------------------------------------------------------

resource "aws_route53_record" "spf" {
  count   = var.route53_zone_id != "" && var.mail_domain != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.mail_domain
  type    = "TXT"
  ttl     = 300
  # -all: anything not from our node is a forgery. Widen only if a second
  # relay is added.
  records = ["v=spf1 ip4:${aws_eip.node.public_ip} -all"]
}

resource "aws_route53_record" "dkim" {
  count   = var.route53_zone_id != "" && var.mail_domain != "" && var.mail_dkim_public_key != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "${var.mail_dkim_selector}._domainkey.${var.mail_domain}"
  type    = "TXT"
  ttl     = 300
  # Route 53 splits strings over 255 chars itself when given a list.
  records = ["v=DKIM1; k=rsa; p=${var.mail_dkim_public_key}"]
}

resource "aws_route53_record" "dmarc" {
  count   = var.route53_zone_id != "" && var.mail_domain != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "_dmarc.${var.mail_domain}"
  type    = "TXT"
  ttl     = 300
  # Start at quarantine with aggregate reports; move to p=reject once the
  # reports come back clean for a couple of weeks.
  records = [
    "v=DMARC1; p=quarantine; rua=mailto:${var.mail_dmarc_rua}; adkim=s; aspf=s; pct=100",
  ]
}
