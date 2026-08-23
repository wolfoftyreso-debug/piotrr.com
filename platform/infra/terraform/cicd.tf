# Image registry and the GitHub Actions deploy identity.
#
# Section 3: "images in ECR", "GitHub Actions with OIDC role". OIDC means no
# long-lived AWS keys live in GitHub — Actions exchanges its own token for a
# short-lived role session, and the role can do exactly two things: push an
# image, and tell the node to roll out.

resource "aws_ecr_repository" "app" {
  name                 = var.project
  image_tag_mutability = "IMMUTABLE" # a tag always means the same build
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = { Name = "${var.project}-ecr" }
}

# Keep the last 30 images; untagged layers go after a day.
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the 30 most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 30
        }
        action = { type = "expire" }
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# GitHub OIDC
# ---------------------------------------------------------------------------

variable "github_repository" {
  description = "owner/repo allowed to assume the deploy role. Empty disables the CI/CD identity entirely."
  type        = string
  default     = ""
}

variable "github_deploy_ref" {
  description = "Git ref allowed to deploy. Defaults to the default branch only."
  type        = string
  default     = "refs/heads/main"
}

# Reuse the account's provider if it already exists; set to false then.
variable "create_github_oidc_provider" {
  description = "Create the token.actions.githubusercontent.com OIDC provider (only one per AWS account)"
  type        = bool
  default     = true
}

resource "aws_iam_openid_connect_provider" "github" {
  count           = var.github_repository != "" && var.create_github_oidc_provider ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "github_assume" {
  count = var.github_repository != "" ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type = "Federated"
      identifiers = [
        var.create_github_oidc_provider
        ? aws_iam_openid_connect_provider.github[0].arn
        : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
      ]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Only this repo, only this ref — not every workflow in the org.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:${var.github_deploy_ref}"]
    }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_iam_role" "github_deploy" {
  count              = var.github_repository != "" ? 1 : 0
  name               = "${var.project}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume[0].json
  tags               = { Name = "${var.project}-github-deploy" }
}

data "aws_iam_policy_document" "github_deploy" {
  count = var.github_repository != "" ? 1 : 0

  statement {
    sid       = "EcrAuth"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # this action does not support resource scoping
  }

  statement {
    sid    = "EcrPush"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.app.arn]
  }

  # Roll out on the node. Scoped to this one instance and one document —
  # the role cannot run arbitrary commands anywhere else in the account.
  statement {
    sid       = "SsmDeploy"
    effect    = "Allow"
    actions   = ["ssm:SendCommand"]
    resources = [
      aws_instance.node.arn,
      "arn:aws:ssm:${var.region}::document/AWS-RunShellScript",
    ]
  }

  statement {
    sid       = "SsmReadResult"
    effect    = "Allow"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
    resources = ["*"] # command ids are not known at policy-write time
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  count  = var.github_repository != "" ? 1 : 0
  name   = "${var.project}-github-deploy"
  role   = aws_iam_role.github_deploy[0].id
  policy = data.aws_iam_policy_document.github_deploy[0].json
}

# The node needs to pull from ECR.
resource "aws_iam_role_policy" "node_ecr_pull" {
  name = "${var.project}-node-ecr-pull"
  role = aws_iam_role.node.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ]
        Resource = aws_ecr_repository.app.arn
      },
    ]
  })
}

output "ecr_repository_url" {
  description = "Push target for CI (set as the ECR_REPOSITORY Actions variable)"
  value       = aws_ecr_repository.app.repository_url
}

output "github_deploy_role_arn" {
  description = "Set as the AWS_DEPLOY_ROLE_ARN Actions variable"
  value       = var.github_repository != "" ? aws_iam_role.github_deploy[0].arn : ""
}
