#!/usr/bin/env bash
#
# MyFinal 部署更新脚本：备份 Postgres -> 拉取新镜像 -> 重建服务 -> 等待健康检查。
# 与同目录的 docker-compose-myfinal.yml 配合使用。
#
# 用法:
#   ./update-myfinal.sh                # 交互确认后执行
#   ./update-myfinal.sh -y             # 跳过确认
#   ./update-myfinal.sh --help         # 查看说明
#
# 可覆盖的环境变量:
#   COMPOSE_FILE        compose 文件路径（默认脚本同目录下的 docker-compose-myfinal.yml）
#   APP_SERVICE         compose 服务名（默认 new-api）
#   APP_CONTAINER       应用容器名（默认 new-api-myfinal）
#   DB_CONTAINER        数据库容器名（默认 postgres-myfinal）
#   DB_USER / DB_NAME   数据库用户 / 库名（默认 root / new-api）
#   BACKUP_ROOT         备份目录（默认 /opt/kuncode/backups）
#   KEEP_BACKUPS        保留最近多少份备份（默认 10，0 表示不清理）
#   HEALTH_TIMEOUT      等待健康检查的秒数（默认 180）
#   PGPASSWORD          容器内本地连接需要密码时通过环境变量传入
#
# 备份内容: 数据库 dump（pg_dump -Fc）、compose 文件。
# 更新前会将当前应用镜像打上 <image>:previous 标签，便于回滚。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/docker-compose-myfinal.yml}"
APP_SERVICE="${APP_SERVICE:-new-api}"
APP_CONTAINER="${APP_CONTAINER:-new-api-myfinal}"
DB_CONTAINER="${DB_CONTAINER:-postgres-myfinal}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-new-api}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/kuncode/backups}"
KEEP_BACKUPS="${KEEP_BACKUPS:-10}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
ASSUME_YES=0

log() { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +'%H:%M:%S')" "$*"; }
fail() {
  printf '\033[1;31m错误:\033[0m %s\n' "$*" >&2
  exit 1
}

for arg in "$@"; do
  case "$arg" in
    -y | --yes) ASSUME_YES=1 ;;
    -h | --help)
      sed -n '2,22p' "$0"
      exit 0
      ;;
    *) fail "未知参数: $arg" ;;
  esac
done

command -v docker >/dev/null 2>&1 || fail "未找到 docker 命令"
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  fail "未找到 docker compose 或 docker-compose"
fi

[ -f "$COMPOSE_FILE" ] || fail "compose 文件不存在: $COMPOSE_FILE"
docker inspect "$APP_CONTAINER" >/dev/null 2>&1 ||
  fail "应用容器不存在: ${APP_CONTAINER}（请先启动服务）"
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 ||
  fail "数据库容器不存在: $DB_CONTAINER"

TIMESTAMP="$(date +'%Y%m%d-%H%M%S')"
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"
PREV_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$APP_CONTAINER")"
CURRENT_IMAGE="$(docker inspect -f '{{.Config.Image}}' "$APP_CONTAINER")"
IMAGE_REPO="${CURRENT_IMAGE%:*}"
[ -n "$IMAGE_REPO" ] || IMAGE_REPO="myfinal12/kuncode"
ROLLBACK_TAG="${IMAGE_REPO}:previous"

log "compose 文件: $COMPOSE_FILE"
log "当前应用镜像: ${CURRENT_IMAGE:-未知} (${PREV_IMAGE_ID})"
log "备份目录: $BACKUP_DIR"

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "确认备份并更新服务? [y/N] " answer || answer=""
  case "$answer" in
    y | Y | yes | YES) ;;
    *)
      echo "已取消"
      exit 0
      ;;
  esac
fi

# 1. 备份数据库与 compose 文件
log "1/4 备份 Postgres 数据库 ($DB_NAME)..."
mkdir -p "$BACKUP_DIR"
if [ -n "${PGPASSWORD:-}" ]; then
  docker exec -e PGPASSWORD "$DB_CONTAINER" pg_dump \
    -U "$DB_USER" -d "$DB_NAME" -Fc > "$BACKUP_DIR/new-api.dump" ||
    fail "pg_dump 执行失败，已中止更新"
else
  docker exec "$DB_CONTAINER" pg_dump \
    -U "$DB_USER" -d "$DB_NAME" -Fc > "$BACKUP_DIR/new-api.dump" ||
    fail "pg_dump 执行失败，已中止更新"
fi
[ -s "$BACKUP_DIR/new-api.dump" ] || fail "数据库备份为空，已中止更新"
cp "$COMPOSE_FILE" "$BACKUP_DIR/"
log "备份完成: $BACKUP_DIR/new-api.dump ($(du -h "$BACKUP_DIR/new-api.dump" | cut -f1))"

if [ "$KEEP_BACKUPS" -gt 0 ]; then
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d |
    sort -r |
    tail -n +"$((KEEP_BACKUPS + 1))" |
    while read -r old_backup; do
      log "清理旧备份: $old_backup"
      rm -rf "$old_backup"
    done
fi

# 2. 记录当前镜像，便于回滚
log "2/4 记录当前镜像为回滚标签 $ROLLBACK_TAG ..."
docker tag "$PREV_IMAGE_ID" "$ROLLBACK_TAG"

# 3. 拉取最新镜像
log "3/4 拉取最新镜像..."
"${COMPOSE[@]}" -f "$COMPOSE_FILE" pull "$APP_SERVICE"

# 4. 重建并重启服务
log "4/4 重建并重启服务..."
"${COMPOSE[@]}" -f "$COMPOSE_FILE" up -d "$APP_SERVICE"

log "等待 $APP_CONTAINER 健康检查（最多 ${HEALTH_TIMEOUT}s）..."
deadline=$((SECONDS + HEALTH_TIMEOUT))
healthy=0
while [ "$SECONDS" -lt "$deadline" ]; do
  status="$(docker inspect \
    -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$APP_CONTAINER" 2>/dev/null || echo missing)"
  case "$status" in
    healthy | running)
      healthy=1
      break
      ;;
    exited | dead | missing) break ;;
  esac
  sleep 3
done

if [ "$healthy" -ne 1 ]; then
  echo "--- 最近 50 行日志 ---"
  docker logs --tail 50 "$APP_CONTAINER" 2>&1 || true
  fail "服务未在 ${HEALTH_TIMEOUT}s 内变为健康，请检查日志；数据库备份在 $BACKUP_DIR"
fi

NEW_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$APP_CONTAINER")"
echo
log "更新完成"
echo "  备份目录:   $BACKUP_DIR"
echo "  当前镜像:   ${CURRENT_IMAGE:-未知} (${NEW_IMAGE_ID})"
echo "  回滚镜像:   $ROLLBACK_TAG"
echo
echo "如需回滚:"
echo "  docker tag $ROLLBACK_TAG ${CURRENT_IMAGE:-$ROLLBACK_TAG}"
echo "  ${COMPOSE[*]} -f $COMPOSE_FILE up -d $APP_SERVICE"
echo "如需恢复数据库备份:"
echo "  docker exec -i $DB_CONTAINER pg_restore -U $DB_USER -d $DB_NAME --clean --if-exists < $BACKUP_DIR/new-api.dump"
