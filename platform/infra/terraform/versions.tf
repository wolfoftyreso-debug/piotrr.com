terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Recommended: keep state in your own account. Uncomment and fill in.
  # backend "s3" {
  #   bucket       = "<your-tfstate-bucket>"
  #   key          = "baltic-bridge/selfhost.tfstate"
  #   region       = "eu-north-1"
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}
