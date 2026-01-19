#!/bin/bash

# AutoGuard Deployment Script
# Usage: ./deploy.sh [command]
# Commands: build, start, stop, restart, logs, status

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_env() {
    if [ ! -f ".env" ]; then
        log_error ".env file not found!"
        log_info "Copy .env.example to .env and configure it:"
        log_info "  cp .env.example .env"
        exit 1
    fi
}

check_geoip() {
    if [ ! -f "geoip/GeoLite2-City.mmdb" ]; then
        log_warn "GeoIP database not found!"
        log_info "Download GeoLite2 databases from MaxMind:"
        log_info "  https://www.maxmind.com/en/geolite2/signup"
        log_info "Place them in: deploy/geoip/"
    fi
}

build() {
    log_info "Building AutoGuard Docker image..."
    docker-compose build
    log_info "Build complete!"
}

start() {
    check_env
    check_geoip
    log_info "Starting AutoGuard..."
    docker-compose up -d
    log_info "AutoGuard started!"
    log_info "Dashboard: http://dashboard.autoguard.dev"
}

stop() {
    log_info "Stopping AutoGuard..."
    docker-compose down
    log_info "AutoGuard stopped!"
}

restart() {
    stop
    start
}

logs() {
    docker-compose logs -f "$@"
}

status() {
    log_info "AutoGuard Status:"
    docker-compose ps
    echo ""
    log_info "Health Check:"
    curl -s http://localhost/health || echo "Service not responding"
}

shell() {
    log_info "Opening shell in AutoGuard container..."
    docker-compose exec autoguard sh
}

# Initialize database
init_db() {
    log_info "Initializing database..."
    docker-compose exec autoguard node -e "
        const { initDatabase } = require('/app/packages/shared/dist/db/connection');
        initDatabase();
        console.log('Database initialized!');
    "
}

# Create admin user
create_admin() {
    if [ -z "$1" ] || [ -z "$2" ]; then
        log_error "Usage: ./deploy.sh create-admin <email> <password>"
        exit 1
    fi

    log_info "Creating admin user: $1"
    docker-compose exec autoguard node -e "
        const bcrypt = require('bcryptjs');
        const { execute } = require('/app/packages/shared/dist/db');
        const passwordHash = bcrypt.hashSync('$2', 12);
        try {
            execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', ['$1', passwordHash]);
            console.log('Admin user created!');
        } catch (e) {
            console.error('Failed to create user:', e.message);
        }
    "
}

# Backup database
backup() {
    BACKUP_DIR="${SCRIPT_DIR}/backups"
    mkdir -p "$BACKUP_DIR"
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="$BACKUP_DIR/autoguard_$TIMESTAMP.db"

    log_info "Creating backup: $BACKUP_FILE"
    docker-compose exec -T autoguard cp /data/db/autoguard.db /tmp/backup.db
    docker cp "$(docker-compose ps -q autoguard)":/tmp/backup.db "$BACKUP_FILE"
    log_info "Backup complete!"
}

# Update GeoIP databases
update_geoip() {
    if [ -z "$MAXMIND_LICENSE_KEY" ]; then
        log_error "MAXMIND_LICENSE_KEY not set!"
        log_info "Get your license key from: https://www.maxmind.com/en/my_license_key"
        exit 1
    fi

    log_info "Updating GeoIP databases..."
    mkdir -p geoip

    # Download City database
    curl -s "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=$MAXMIND_LICENSE_KEY&suffix=tar.gz" | \
        tar -xzf - --strip-components=1 -C geoip --wildcards "*.mmdb"

    # Download ASN database
    curl -s "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-ASN&license_key=$MAXMIND_LICENSE_KEY&suffix=tar.gz" | \
        tar -xzf - --strip-components=1 -C geoip --wildcards "*.mmdb"

    log_info "GeoIP databases updated!"
}

# Main
case "$1" in
    build)
        build
        ;;
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    logs)
        shift
        logs "$@"
        ;;
    status)
        status
        ;;
    shell)
        shell
        ;;
    init-db)
        init_db
        ;;
    create-admin)
        create_admin "$2" "$3"
        ;;
    backup)
        backup
        ;;
    update-geoip)
        update_geoip
        ;;
    *)
        echo "AutoGuard Deployment Script"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  build         Build Docker image"
        echo "  start         Start AutoGuard"
        echo "  stop          Stop AutoGuard"
        echo "  restart       Restart AutoGuard"
        echo "  logs          View logs (follow mode)"
        echo "  status        Show status"
        echo "  shell         Open shell in container"
        echo "  init-db       Initialize database"
        echo "  create-admin  Create admin user"
        echo "  backup        Backup database"
        echo "  update-geoip  Update GeoIP databases"
        ;;
esac
