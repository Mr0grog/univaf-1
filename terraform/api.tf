# Add DNS (optional)
data "aws_route53_zone" "domain_zone" {
  count = var.domain_name != "" ? 1 : 0
  name  = var.domain_name
}

resource "aws_route53_record" "api_domain_record" {
  count = var.domain_name != "" ? 1 : 0

  zone_id = data.aws_route53_zone.domain_zone[0].zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.univaf_api[0].domain_name
    zone_id                = aws_cloudfront_distribution.univaf_api[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api_www_domain_record" {
  count   = var.domain_name != "" ? 1 : 0
  zone_id = data.aws_route53_zone.domain_zone[0].zone_id
  name    = "www"
  type    = "CNAME"
  records = [var.domain_name]
  ttl     = 300
}


# These log groups and streams are associated with a tasks that no longer run,
# but we are preserving the logs for a little while longer.
resource "aws_cloudwatch_log_group" "data_snapshot_log_group" {
  name              = "/ecs/daily-data-snapshot"
  retention_in_days = 30

  tags = {
    Name = "daily-data-snapshot"
  }
}

resource "aws_cloudwatch_log_stream" "data_snapshot_log_stream" {
  name           = "daily-data-snapshot-log-stream"
  log_group_name = aws_cloudwatch_log_group.data_snapshot_log_group.name
}

# API Service -----------------------------------------------------------------

resource "aws_alb" "main" {
  name                       = "api-load-balancer"
  subnets                    = aws_subnet.public.*.id
  security_groups            = [aws_security_group.lb.id]
  drop_invalid_header_fields = true
}

resource "aws_alb_target_group" "api" {
  name        = "api-target-group"
  port        = var.api_port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    healthy_threshold   = "3"
    interval            = "30"
    protocol            = "HTTP"
    matcher             = "200"
    timeout             = "3"
    path                = var.api_health_check_path
    unhealthy_threshold = "2"
  }
}

# Redirect all traffic from the ALB to the target group
resource "aws_alb_listener" "front_end" {
  load_balancer_arn = aws_alb.main.id
  port              = 80
  protocol          = "HTTP"

  default_action {
    target_group_arn = aws_alb_target_group.api.arn
    type             = "forward"
  }
}

resource "aws_alb_listener_rule" "redirect_www" {
  listener_arn = aws_alb_listener.front_end.arn

  condition {
    host_header {
      values = ["www.${var.domain_name}"]
    }
  }

  action {
    type = "redirect"

    redirect {
      host        = var.domain_name
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

module "api_task" {
  source = "./modules/task"

  name  = "api"
  image = "${aws_ecr_repository.server_repository.repository_url}:${var.api_release_version}"
  # FIXME: it's possible this isn't required (it's *technically* not)
  # role = aws_iam_role.ecs_task_execution_role.arn
  # Only certain CPU/Memory combinations are allowed. See:
  # https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html#fargate-tasks-size
  cpu    = var.api_cpu
  memory = var.api_memory
  port   = var.api_port

  # Enable Datadog
  datadog_enabled = true
  datadog_api_key = var.datadog_api_key

  env_vars = {
    RELEASE                   = var.api_release_version
    DB_HOST                   = module.db.host
    DB_NAME                   = module.db.db_name
    DB_USERNAME               = var.db_user
    DB_PASSWORD               = var.db_password
    API_KEYS                  = join(",", var.api_keys)
    SENTRY_DSN                = var.api_sentry_dsn
    SENTRY_TRACES_SAMPLE_RATE = format("%.2f", var.api_sentry_traces_sample_rate)
    PRIMARY_HOST              = var.domain_name
  }

  depends_on = [aws_alb_listener.front_end, aws_iam_role_policy_attachment.ecs_task_execution_role]
}

resource "aws_cloudwatch_log_group" "api_log_group" {
  name              = "/ecs/api"
  retention_in_days = 30

  tags = {
    Name = "api"
  }
}

resource "aws_cloudwatch_log_stream" "api_log_stream" {
  name           = "api-log-stream"
  log_group_name = aws_cloudwatch_log_group.api_log_group.name
}

resource "aws_ecs_service" "api_service" {
  name            = "api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = module.api_task.arn
  desired_count   = 1 # This will get adjusted by autoscaling rules
  launch_type     = "FARGATE"

  lifecycle {
    # Autoscaling rules will tweak this dynamically. Ignore it so Terraform
    # doesn't reset things on every run.
    ignore_changes = [desired_count]
  }

  network_configuration {
    security_groups  = [aws_security_group.ecs_tasks.id]
    subnets          = aws_subnet.private.*.id
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_alb_target_group.api.id
    container_name   = "api"
    container_port   = var.api_port
  }

  depends_on = [aws_alb_listener.front_end, aws_iam_role_policy_attachment.ecs_task_execution_role, module.api_task]
}

# Use CloudFront as a caching layer in front of the API server (Render does not
# provide a built-in one). Enabled only if var.domain, var.api_remote_domain and
# var.ssl_certificate_arn are provided.
resource "aws_cloudfront_distribution" "univaf_api" {
  count = (
    var.domain_name != ""
    && var.ssl_certificate_arn != ""
    && var.api_remote_domain_name != "" ? 1 : 0
  )
  enabled      = true
  price_class  = "PriceClass_100" # North America
  aliases      = [var.domain_name, "www.${var.domain_name}"]
  http_version = "http2and3"

  origin {
    origin_id   = var.domain_name
    domain_name = var.api_remote_domain_name

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_ssl_protocols   = ["SSLv3", "TLSv1", "TLSv1.1", "TLSv1.2"]
      origin_protocol_policy = var.api_remote_domain_name != "" ? "https-only" : "http-only"
    }
  }

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = var.domain_name
    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    max_ttl                = 3600

    forwarded_values {
      headers      = ["Host", "Origin"]
      query_string = true

      cookies {
        forward = "none"
      }
    }
  }

  viewer_certificate {
    acm_certificate_arn = var.ssl_certificate_arn
    ssl_support_method  = "sni-only"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}
