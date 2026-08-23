# Minimal monitoring: hardware failure auto-recovers; humans get email
# (only when alarm_email is set — SNS subscription requires confirmation).

locals {
  alarm_actions = var.alarm_email == "" ? [] : [aws_sns_topic.alarms[0].arn]
}

resource "aws_sns_topic" "alarms" {
  count = var.alarm_email == "" ? 0 : 1
  name  = "${var.project}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Underlying host failure -> automatic recovery (same volume, same EIP)
resource "aws_cloudwatch_metric_alarm" "system_failed" {
  alarm_name          = "${var.project}-system-check-failed"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  dimensions          = { InstanceId = aws_instance.node.id }

  alarm_actions = concat(
    ["arn:aws:automate:${var.region}:ec2:recover"],
    local.alarm_actions,
  )
}

resource "aws_cloudwatch_metric_alarm" "instance_failed" {
  alarm_name          = "${var.project}-instance-check-failed"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_Instance"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  dimensions          = { InstanceId = aws_instance.node.id }
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  alarm_name          = "${var.project}-cpu-high"
  namespace           = "AWS/EC2"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 90
  comparison_operator = "GreaterThanThreshold"
  dimensions          = { InstanceId = aws_instance.node.id }
  alarm_actions       = local.alarm_actions
}
