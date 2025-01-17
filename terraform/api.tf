# API Service
#
# The API server (code in the `server` directory) runs as a service on ECS. It
# serves the public API and receives updates from the loaders.
#
# The API also has a scheduled job that runs once a day to archive the state of
# the database and log all the updates it received that day. That job is also
# a task that runs on ECS (but just a task that runs to completion, not a
# service that ECS keeps running).

# API Service -----------------------------------------------------------------

# The actual task that runs on ECS.
module "api_task" {
  source = "./modules/task"

  name  = "api"
  image = "${aws_ecr_repository.server_repository.repository_url}:${var.api_release_version}"
  role  = aws_iam_role.ecs_task_execution_role.arn
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

# The service's load balancer.
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

# This service definition keeps the API server task running, connects it to the
# load balancer, and manages multiple instances. (The actual scaling policies
# are in a separate file.)
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


# Daily Data Snapshot ---------------------------------------------------------

# The snapshot task runs once a day to archive the contents of the database and
# update logs to S3 so others can do historical analysis.
module "daily_data_snapshot_task" {
  source = "./modules/task"

  name    = "daily-data-snapshot"
  image   = "${aws_ecr_repository.server_repository.repository_url}:${var.api_release_version}"
  command = ["node", "scripts/availability_dump.js", "--write-to-s3", "--clear-log"]
  role    = aws_iam_role.ecs_task_execution_role.arn

  env_vars = {
    DB_HOST                 = module.db.host
    DB_NAME                 = module.db.db_name
    DB_USERNAME             = var.db_user
    DB_PASSWORD             = var.db_password
    DB_POOL_SIZE_DATA       = "15"
    SENTRY_DSN              = var.api_sentry_dsn
    DATA_SNAPSHOT_S3_BUCKET = var.data_snapshot_s3_bucket
    AWS_ACCESS_KEY_ID       = var.data_snapshot_aws_key_id
    AWS_SECRET_ACCESS_KEY   = var.data_snapshot_aws_secret_key
    AWS_DEFAULT_REGION      = var.aws_region
  }
}

module "daily_data_snapshot_schedule" {
  source = "./modules/schedule"

  schedule        = "cron(0 1 * * ? *)"
  task            = module.daily_data_snapshot_task
  cluster_arn     = aws_ecs_cluster.main.arn
  subnets         = aws_subnet.private.*.id
  security_groups = [aws_security_group.ecs_tasks.id]
}
