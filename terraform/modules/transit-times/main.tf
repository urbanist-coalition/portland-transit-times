terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

variable "deployment_name" {
  type        = string
  description = "The name of the deployment"
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

locals {
  # Strip off trailing digits for app platform
  app_region = regex("^([a-z]+)", var.region)
}

resource "digitalocean_database_cluster" "redis" {
  name       = var.deployment_name
  project_id = var.project_id
  engine     = "redis"
  version    = "7"
  size       = "db-s-1vcpu-1gb"
  region     = var.region
  node_count = 1
}

resource "digitalocean_app" "portland-me-transit-times" {
  project_id = var.project_id

  spec {
    name   = var.deployment_name
    region = local.app_region

    service {
      name               = "webservice"
      instance_count     = 1
      instance_size_slug = "apps-s-1vcpu-1gb"

      github {
        repo           = var.repo
        branch         = var.branch
        deploy_on_push = true
      }
    }

    worker {
      name               = "worker"
      instance_count     = 1
      instance_size_slug = "apps-s-1vcpu-1gb"

      build_command = "npm install"
      run_command   = "npm run worker"

      github {
        repo           = var.repo
        branch         = var.branch
        deploy_on_push = true
      }
    }

    env {
      key   = "REDIS_URL"
      value = digitalocean_database_cluster.redis.uri
      type  = "SECRET"
    }
  }
}
