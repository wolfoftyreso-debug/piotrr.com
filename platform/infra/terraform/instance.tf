# One EC2 node (Graviton, Ubuntu 24.04 LTS) running the self-hosted compose
# stack from docker-compose.selfhost.yml. Admin access via SSM Session
# Manager — no SSH key pairs, port 22 closed unless admin_ssh_cidr is set.

data "aws_ami" "ubuntu_arm64" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_iam_role" "node" {
  name = "${var.project}-node"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

# Session Manager shell access (replaces SSH)
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Write-only access to the backup bucket (nightly pg_dump upload)
resource "aws_iam_role_policy" "backup_writer" {
  name = "${var.project}-backup-writer"
  role = aws_iam_role.node.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.backups.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.backups.arn
      }
    ]
  })
}

resource "aws_iam_instance_profile" "node" {
  name = "${var.project}-node"
  role = aws_iam_role.node.name
}

# All persistent state (Docker volumes: pgdata, miniodata) lives here.
# DLM snapshots this volume daily — see backup.tf.
resource "aws_ebs_volume" "data" {
  availability_zone = aws_subnet.public.availability_zone
  size              = var.data_volume_gb
  type              = "gp3"
  encrypted         = true

  tags = {
    Name   = "${var.project}-data"
    Backup = "true"
  }
}

resource "aws_instance" "node" {
  ami                    = data.aws_ami.ubuntu_arm64.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.node.id]
  iam_instance_profile   = aws_iam_instance_profile.node.name

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    data_volume_id = aws_ebs_volume.data.id
    backup_bucket  = aws_s3_bucket.backups.bucket
    region         = var.region
    orchestrator   = var.orchestrator
  })

  # Replacing the instance must never destroy the data volume.
  lifecycle {
    ignore_changes = [ami] # newer AMIs shouldn't force replacement; patch in place
  }

  tags = { Name = "${var.project}-node" }
}

resource "aws_volume_attachment" "data" {
  device_name                    = "/dev/sdf"
  volume_id                      = aws_ebs_volume.data.id
  instance_id                    = aws_instance.node.id
  stop_instance_before_detaching = true
}

# Stable public IP — DNS points here; survives instance replacement.
resource "aws_eip" "node" {
  domain   = "vpc"
  instance = aws_instance.node.id

  tags = { Name = "${var.project}-eip" }
}
