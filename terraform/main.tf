terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }

  backend "s3" {}
}

variable "do_token" {
  type        = string
  sensitive   = true
  description = "The DigitalOcean API token"
}

variable "project_id" {
  type        = string
  description = "The DigitalOcean project ID"
}

variable "region" {
  type        = string
  description = "Datacenter region slug (e.g., nyc1, sfo3, ams3)"
}

variable "repo" {
  type        = string
  description = "The GitHub repository to deploy"
}

variable "branch" {
  type        = string
  description = "The branch of the GitHub repository to deploy"
  default     = "main"
}

provider "digitalocean" {
  token = var.do_token
}

module "transit-times" {
  source          = "./modules/transit-times"
  deployment_name = "portland-me-transit-times"
  project_id      = var.project_id
  region          = var.region
  repo            = var.repo
  branch          = var.branch
}
