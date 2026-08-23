output "public_ip" {
  description = "Stable EIP — point app_domain and files_domain here"
  value       = aws_eip.node.public_ip
}

output "instance_id" {
  description = "EC2 instance id"
  value       = aws_instance.node.id
}

output "ssm_session_command" {
  description = "Open an admin shell (no SSH needed)"
  value       = "aws ssm start-session --target ${aws_instance.node.id} --region ${var.region}"
}

output "backup_bucket" {
  description = "S3 bucket receiving nightly pg_dump files under pg/"
  value       = aws_s3_bucket.backups.bucket
}

output "data_volume_id" {
  description = "EBS volume holding all persistent state (DLM-snapshotted daily)"
  value       = aws_ebs_volume.data.id
}
