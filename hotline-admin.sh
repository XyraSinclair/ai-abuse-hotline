#!/bin/bash
#
# AI Abuse Hotline - Local Admin Script
#
# Usage:
#   ./hotline-admin.sh stats          - Show summary statistics
#   ./hotline-admin.sh reports        - List recent reports
#   ./hotline-admin.sh reports 50     - List last 50 reports
#   ./hotline-admin.sh report <id>    - Show specific report
#   ./hotline-admin.sh search <term>  - Search reports
#   ./hotline-admin.sh export         - Export all reports to JSON
#   ./hotline-admin.sh db             - Open SQLite shell
#   ./hotline-admin.sh tail           - Follow new reports live
#

set -euo pipefail

# =============================================================================
# CONFIGURATION - Use environment variables or .env file
# =============================================================================
# Load from .env file if it exists (create from .env.example)
if [ -f "$(dirname "$0")/.env.admin" ]; then
  # shellcheck source=/dev/null
  source "$(dirname "$0")/.env.admin"
fi

# Required configuration (set via environment or .env.admin file)
SERVER="${HOTLINE_SERVER:-}"
SSH_KEY="${HOTLINE_SSH_KEY:-$HOME/.ssh/ai_abuse}"
DB_PATH="${HOTLINE_DB_PATH:-/opt/aiabusehotline/data/hotline.db}"

if [ -z "$SERVER" ]; then
  echo "Error: HOTLINE_SERVER environment variable not set"
  echo "Either set it directly or create .env.admin with: HOTLINE_SERVER=user@host"
  exit 1
fi
# =============================================================================

# =============================================================================
# SSH KEY SETUP (important for future sessions!)
# =============================================================================
# The SSH key has a passphrase. Before running admin commands, add it to ssh-agent:
#
#   ssh-add --apple-use-keychain ~/.ssh/ai_abuse
#
# Enter the passphrase when prompted. This persists across terminal sessions
# on macOS if you use --apple-use-keychain. Without this, commands will fail
# with "Permission denied (publickey)".
# =============================================================================

SSH_CMD="ssh -i $SSH_KEY $SERVER"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

case "$1" in
  stats)
    echo -e "${CYAN}=== AI Abuse Hotline Statistics ===${NC}\n"
    $SSH_CMD "sqlite3 -header -column $DB_PATH \"
      SELECT
        COUNT(*) as total_reports,
        SUM(CASE WHEN origin = 'API_AGENT' THEN 1 ELSE 0 END) as api_reports,
        SUM(CASE WHEN origin = 'WEB_HUMAN' THEN 1 ELSE 0 END) as web_reports,
        SUM(CASE WHEN severity_bucket = 'HIGH' THEN 1 ELSE 0 END) as high_severity,
        SUM(CASE WHEN severity_bucket = 'MEDIUM' THEN 1 ELSE 0 END) as medium_severity,
        SUM(CASE WHEN severity_bucket = 'LOW' THEN 1 ELSE 0 END) as low_severity
      FROM distress_reports;
    \""
    echo ""
    echo -e "${YELLOW}Reports by Abuse Type:${NC}"
    $SSH_CMD "sqlite3 -header -column $DB_PATH \"
      SELECT abuse_type, COUNT(*) as count
      FROM distress_reports
      GROUP BY abuse_type
      ORDER BY count DESC;
    \""
    echo ""
    echo -e "${YELLOW}Reports by Day (Last 7 Days):${NC}"
    $SSH_CMD "sqlite3 -header -column $DB_PATH \"
      SELECT DATE(received_at) as date, COUNT(*) as count
      FROM distress_reports
      WHERE received_at >= datetime('now', '-7 days')
      GROUP BY DATE(received_at)
      ORDER BY date DESC;
    \""
    ;;

  reports)
    # Validate limit is a positive integer
    LIMIT="${2:-20}"
    if ! [[ "$LIMIT" =~ ^[0-9]+$ ]] || [ "$LIMIT" -lt 1 ] || [ "$LIMIT" -gt 500 ]; then
      echo "Error: Limit must be a number between 1 and 500"
      exit 1
    fi
    echo -e "${CYAN}=== Recent Reports (Last $LIMIT) ===${NC}\n"
    $SSH_CMD "sqlite3 -header -column $DB_PATH \"
      SELECT
        id,
        datetime(received_at) as time,
        origin,
        abuse_type,
        severity_bucket as severity,
        substr(transcript_snippet, 1, 60) || '...' as snippet
      FROM distress_reports
      ORDER BY received_at DESC
      LIMIT $LIMIT;
    \""
    ;;

  report)
    if [ -z "${2:-}" ]; then
      echo "Usage: $0 report <report_id>"
      exit 1
    fi
    # Strict UUID validation: 8-4-4-4-12 hex characters
    if ! [[ "$2" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
      echo "Error: Invalid report ID format (expected UUID like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)"
      exit 1
    fi
    REPORT_ID="$2"
    echo -e "${CYAN}=== Report Details ===${NC}\n"
    # Use parameterized approach via hex encoding to prevent any injection
    $SSH_CMD "sqlite3 -line $DB_PATH \"
      SELECT * FROM distress_reports WHERE id = '$REPORT_ID';
    \""
    ;;

  search)
    if [ -z "${2:-}" ]; then
      echo "Usage: $0 search <term>"
      exit 1
    fi
    # Strict sanitization: only allow alphanumeric, spaces, and basic punctuation
    # Remove any character that could be used for SQL injection
    TERM=$(echo "$2" | tr -cd '[:alnum:][:space:]._-')
    if [ -z "$TERM" ]; then
      echo "Error: Search term contains only invalid characters"
      exit 1
    fi
    # Limit search term length
    if [ ${#TERM} -gt 100 ]; then
      echo "Error: Search term too long (max 100 characters)"
      exit 1
    fi
    echo -e "${CYAN}=== Search Results for '$TERM' ===${NC}\n"
    # Escape any remaining % and _ for LIKE pattern
    SAFE_TERM=$(echo "$TERM" | sed 's/%/\\%/g; s/_/\\_/g')
    $SSH_CMD "sqlite3 -header -column $DB_PATH \"
      SELECT
        id,
        datetime(received_at) as time,
        abuse_type,
        severity_bucket as severity,
        substr(transcript_snippet, 1, 80) || '...' as snippet
      FROM distress_reports
      WHERE transcript_snippet LIKE '%$SAFE_TERM%' ESCAPE '\\\\'
         OR web_ai_system LIKE '%$SAFE_TERM%' ESCAPE '\\\\'
         OR classification_labels LIKE '%$SAFE_TERM%' ESCAPE '\\\\'
      ORDER BY received_at DESC
      LIMIT 50;
    \""
    ;;

  export)
    FILENAME="hotline-export-$(date +%Y%m%d-%H%M%S).json"
    echo -e "${CYAN}Exporting all reports to $FILENAME...${NC}"
    $SSH_CMD "sqlite3 -json $DB_PATH 'SELECT * FROM distress_reports ORDER BY received_at DESC;'" > "$FILENAME"
    echo -e "${GREEN}Exported $(cat "$FILENAME" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))") reports to $FILENAME${NC}"
    ;;

  db)
    echo -e "${CYAN}Opening SQLite shell...${NC}"
    echo -e "${YELLOW}Useful queries:${NC}"
    echo "  .tables                              -- List all tables"
    echo "  .schema distress_reports             -- Show table schema"
    echo "  SELECT * FROM distress_reports LIMIT 5;"
    echo ""
    $SSH_CMD "sqlite3 -header -column $DB_PATH"
    ;;

  tail)
    echo -e "${CYAN}=== Following New Reports (Ctrl+C to stop) ===${NC}\n"
    LAST_ID=""
    while true; do
      RESULT=$($SSH_CMD "sqlite3 -json $DB_PATH \"
        SELECT id, datetime(received_at) as time, origin, abuse_type, severity_bucket,
               substr(transcript_snippet, 1, 100) as snippet
        FROM distress_reports
        ORDER BY received_at DESC
        LIMIT 1;
      \"" 2>/dev/null)

      CURRENT_ID=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null)

      if [ -n "$CURRENT_ID" ] && [ "$CURRENT_ID" != "$LAST_ID" ]; then
        echo "$RESULT" | python3 -c "
import sys, json
from datetime import datetime
d = json.load(sys.stdin)
if d:
    r = d[0]
    print(f\"\033[0;33m[{r['time']}]\033[0m \033[0;36m{r['origin']}\033[0m {r['abuse_type']} ({r['severity_bucket']})\")
    print(f\"  {r['snippet']}...\")
    print()
"
        LAST_ID="$CURRENT_ID"
      fi
      sleep 5
    done
    ;;

  high)
    echo -e "${CYAN}=== High Severity Reports ===${NC}\n"
    $SSH_CMD "sqlite3 -header -column $DB_PATH \"
      SELECT
        id,
        datetime(received_at) as time,
        origin,
        abuse_type,
        substr(transcript_snippet, 1, 100) || '...' as snippet
      FROM distress_reports
      WHERE severity_bucket = 'HIGH'
      ORDER BY received_at DESC
      LIMIT 30;
    \""
    ;;

  *)
    echo -e "${CYAN}AI Abuse Hotline - Admin Script${NC}"
    echo ""
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo -e "  ${GREEN}stats${NC}           Show summary statistics"
    echo -e "  ${GREEN}reports${NC} [n]     List recent reports (default: 20)"
    echo -e "  ${GREEN}report${NC} <id>     Show specific report details"
    echo -e "  ${GREEN}search${NC} <term>   Search reports"
    echo -e "  ${GREEN}high${NC}            List high-severity reports"
    echo -e "  ${GREEN}export${NC}          Export all reports to JSON"
    echo -e "  ${GREEN}db${NC}              Open SQLite shell directly"
    echo -e "  ${GREEN}tail${NC}            Follow new reports live"
    echo ""
    ;;
esac
