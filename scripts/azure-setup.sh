#!/usr/bin/env bash
set -euo pipefail

#
# One-time Azure infrastructure setup for SignalSentry deployment.
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - GitHub CLI installed and logged in (gh auth login)
#   - psql client installed
#
# Usage:
#   ./scripts/azure-setup.sh                     # Interactive setup
#   ./scripts/azure-setup.sh setup-dns            # DNS setup (run after first prod deploy)
#

# ── Configuration ────────────────────────────────────────────────────────────

APPS_RG="rg-signalsentry-apps"
DNS_RG="signal-sentry"
DB_RG="burnsforce"
LOCATION="centralus"
GITHUB_REPO="patrickrb/sigint-project"
APP_NAME="signalsentry-github-actions"
DOMAIN="signalsentry.io"
DB_SERVER="primary-burns-db"
DB_APP_USER="signalsentry_app"
PROD_DB="signalsentry_prod"

# ── Helpers ──────────────────────────────────────────────────────────────────

log()  { echo -e "\033[1;34m==>\033[0m $*"; }
warn() { echo -e "\033[1;33mWARN:\033[0m $*"; }
err()  { echo -e "\033[1;31mERROR:\033[0m $*" >&2; exit 1; }

prompt_secret() {
  local varname="$1" prompt="$2"
  read -rsp "$prompt: " "$varname"
  echo
}

check_deps() {
  for cmd in az gh psql openssl; do
    command -v "$cmd" &>/dev/null || err "$cmd is required but not installed"
  done
  az account show &>/dev/null || err "Not logged in to Azure CLI. Run: az login"
}

# ── Main Setup ───────────────────────────────────────────────────────────────

setup_infra() {
  check_deps

  log "Gathering Azure account info..."
  SUBSCRIPTION_ID=$(az account show --query id -o tsv)
  TENANT_ID=$(az account show --query tenantId -o tsv)
  log "Subscription: $SUBSCRIPTION_ID"
  log "Tenant: $TENANT_ID"

  # Prompt for DB admin credentials
  read -rp "Database admin username: " DB_ADMIN_USER
  prompt_secret DB_ADMIN_PASSWORD "Database admin password"

  # ── Resource Group ───────────────────────────────────────────────────────
  log "Creating resource group $APPS_RG in $LOCATION..."
  az group create --name "$APPS_RG" --location "$LOCATION" -o none

  # ── Container App Environments ───────────────────────────────────────────
  log "Creating production ACA environment..."
  az containerapp env create \
    --name signalsentry-prod \
    --resource-group "$APPS_RG" \
    --location "$LOCATION" \
    -o none

  log "Creating staging ACA environment..."
  az containerapp env create \
    --name signalsentry-staging \
    --resource-group "$APPS_RG" \
    --location "$LOCATION" \
    -o none

  # ── Azure AD App Registration + Service Principal ────────────────────────
  log "Creating Azure AD app registration: $APP_NAME..."
  CLIENT_ID=$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)
  log "Client ID: $CLIENT_ID"

  log "Creating service principal..."
  SP_OBJECT_ID=$(az ad sp create --id "$CLIENT_ID" --query id -o tsv 2>/dev/null || \
    az ad sp show --id "$CLIENT_ID" --query id -o tsv)

  # ── Role Assignments ─────────────────────────────────────────────────────
  log "Assigning Contributor role on $APPS_RG..."
  az role assignment create \
    --assignee "$SP_OBJECT_ID" \
    --role "Contributor" \
    --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$APPS_RG" \
    -o none 2>/dev/null || warn "Role may already exist"

  log "Assigning DNS Zone Contributor on $DNS_RG..."
  az role assignment create \
    --assignee "$SP_OBJECT_ID" \
    --role "DNS Zone Contributor" \
    --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$DNS_RG" \
    -o none 2>/dev/null || warn "Role may already exist"

  # ── OIDC Federated Credentials ──────────────────────────────────────────
  APP_OBJECT_ID=$(az ad app show --id "$CLIENT_ID" --query id -o tsv)

  log "Creating OIDC credential for main branch..."
  az ad app federated-credential create --id "$APP_OBJECT_ID" --parameters "{
    \"name\": \"github-main\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:${GITHUB_REPO}:ref:refs/heads/main\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" -o none 2>/dev/null || warn "Main branch credential may already exist"

  log "Creating OIDC credential for pull requests..."
  az ad app federated-credential create --id "$APP_OBJECT_ID" --parameters "{
    \"name\": \"github-pr\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:${GITHUB_REPO}:pull_request\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" -o none 2>/dev/null || warn "PR credential may already exist"

  # ── Database Setup ───────────────────────────────────────────────────────
  DB_HOST="${DB_SERVER}.postgres.database.azure.com"
  DB_APP_PASSWORD=$(openssl rand -hex 24)

  log "Creating database app user: $DB_APP_USER..."
  PGPASSWORD="$DB_ADMIN_PASSWORD" psql \
    "host=$DB_HOST dbname=postgres user=$DB_ADMIN_USER sslmode=require" \
    -c "DO \$\$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_APP_USER}') THEN
        CREATE ROLE ${DB_APP_USER} LOGIN PASSWORD '${DB_APP_PASSWORD}';
      ELSE
        ALTER ROLE ${DB_APP_USER} PASSWORD '${DB_APP_PASSWORD}';
      END IF;
    END \$\$;" 2>/dev/null

  log "Creating production database: $PROD_DB..."
  PGPASSWORD="$DB_ADMIN_PASSWORD" psql \
    "host=$DB_HOST dbname=postgres user=$DB_ADMIN_USER sslmode=require" \
    -c "SELECT 1 FROM pg_database WHERE datname = '${PROD_DB}'" | grep -q 1 || \
  PGPASSWORD="$DB_ADMIN_PASSWORD" psql \
    "host=$DB_HOST dbname=postgres user=$DB_ADMIN_USER sslmode=require" \
    -c "CREATE DATABASE ${PROD_DB} OWNER ${DB_APP_USER};"

  PGPASSWORD="$DB_ADMIN_PASSWORD" psql \
    "host=$DB_HOST dbname=$PROD_DB user=$DB_ADMIN_USER sslmode=require" \
    -c "GRANT ALL PRIVILEGES ON DATABASE ${PROD_DB} TO ${DB_APP_USER};
        GRANT CREATE ON SCHEMA public TO ${DB_APP_USER};
        GRANT USAGE ON SCHEMA public TO ${DB_APP_USER};
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${DB_APP_USER};
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${DB_APP_USER};"

  # ── Generate Secrets ─────────────────────────────────────────────────────
  JWT_SECRET=$(openssl rand -hex 32)
  NEXTAUTH_SECRET=$(openssl rand -hex 32)
  TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)

  # ── Output ───────────────────────────────────────────────────────────────
  echo
  log "Setup complete! Configure these GitHub repository secrets:"
  echo
  echo "┌──────────────────────────┬──────────────────────────────────────────────────┐"
  printf "│ %-24s │ %-48s │\n" "Secret Name" "Value"
  echo "├──────────────────────────┼──────────────────────────────────────────────────┤"
  printf "│ %-24s │ %-48s │\n" "AZURE_CLIENT_ID"        "$CLIENT_ID"
  printf "│ %-24s │ %-48s │\n" "AZURE_TENANT_ID"        "$TENANT_ID"
  printf "│ %-24s │ %-48s │\n" "AZURE_SUBSCRIPTION_ID"  "$SUBSCRIPTION_ID"
  printf "│ %-24s │ %-48s │\n" "DATABASE_HOST"          "$DB_HOST"
  printf "│ %-24s │ %-48s │\n" "DATABASE_ADMIN_USER"    "$DB_ADMIN_USER"
  printf "│ %-24s │ %-48s │\n" "DATABASE_ADMIN_PASSWORD" "$DB_ADMIN_PASSWORD"
  printf "│ %-24s │ %-48s │\n" "DATABASE_APP_PASSWORD"  "$DB_APP_PASSWORD"
  printf "│ %-24s │ %-48s │\n" "PROD_JWT_SECRET"        "$JWT_SECRET"
  printf "│ %-24s │ %-48s │\n" "PROD_NEXTAUTH_SECRET"   "$NEXTAUTH_SECRET"
  printf "│ %-24s │ %-48s │\n" "PROD_TOKEN_ENCRYPTION_KEY" "$TOKEN_ENCRYPTION_KEY"
  echo "└──────────────────────────┴──────────────────────────────────────────────────┘"
  echo
  echo "Also create a GitHub PAT with 'read:packages' scope and add as secret:"
  echo "  GHCR_PAT = <your-pat>"
  echo
  echo "To set secrets via CLI:"
  echo "  gh secret set AZURE_CLIENT_ID --body \"$CLIENT_ID\" --repo $GITHUB_REPO"
  echo "  gh secret set AZURE_TENANT_ID --body \"$TENANT_ID\" --repo $GITHUB_REPO"
  echo "  gh secret set AZURE_SUBSCRIPTION_ID --body \"$SUBSCRIPTION_ID\" --repo $GITHUB_REPO"
  echo "  gh secret set DATABASE_HOST --body \"$DB_HOST\" --repo $GITHUB_REPO"
  echo "  gh secret set DATABASE_ADMIN_USER --body \"$DB_ADMIN_USER\" --repo $GITHUB_REPO"
  echo "  gh secret set DATABASE_ADMIN_PASSWORD --body \"$DB_ADMIN_PASSWORD\" --repo $GITHUB_REPO"
  echo "  gh secret set DATABASE_APP_PASSWORD --body \"$DB_APP_PASSWORD\" --repo $GITHUB_REPO"
  echo "  gh secret set PROD_JWT_SECRET --body \"$JWT_SECRET\" --repo $GITHUB_REPO"
  echo "  gh secret set PROD_NEXTAUTH_SECRET --body \"$NEXTAUTH_SECRET\" --repo $GITHUB_REPO"
  echo "  gh secret set PROD_TOKEN_ENCRYPTION_KEY --body \"$TOKEN_ENCRYPTION_KEY\" --repo $GITHUB_REPO"
  echo
  warn "Save the DATABASE_APP_PASSWORD somewhere safe — it cannot be recovered."
  echo
  log "Next step: Run 'scripts/azure-setup.sh setup-dns' after your first production deploy."
}

# ── DNS Setup (post first deploy) ────────────────────────────────────────────

setup_dns() {
  check_deps

  log "Fetching production environment static IP..."
  ENVIRONMENT_IP=$(az containerapp env show \
    --name signalsentry-prod \
    --resource-group "$APPS_RG" \
    --query "properties.staticIp" -o tsv)

  log "Fetching production API FQDN..."
  API_FQDN=$(az containerapp show \
    --name signalsentry-prod-api \
    --resource-group "$APPS_RG" \
    --query "properties.configuration.ingress.fqdn" -o tsv)

  ENVIRONMENT_FQDN=$(az containerapp env show \
    --name signalsentry-prod \
    --resource-group "$APPS_RG" \
    --query "properties.defaultDomain" -o tsv)

  ENVIRONMENT_VERIFICATION=$(az containerapp env show \
    --name signalsentry-prod \
    --resource-group "$APPS_RG" \
    --query "properties.customDomainConfiguration.customDomainVerificationId" -o tsv)

  log "Environment IP: $ENVIRONMENT_IP"
  log "API FQDN: $API_FQDN"
  log "Environment domain: $ENVIRONMENT_FQDN"

  # ── DNS Records ──────────────────────────────────────────────────────────
  log "Creating A record for $DOMAIN → $ENVIRONMENT_IP..."
  az network dns record-set a add-record \
    --resource-group "$DNS_RG" \
    --zone-name "$DOMAIN" \
    --record-set-name "@" \
    --ipv4-address "$ENVIRONMENT_IP" \
    -o none 2>/dev/null || warn "A record may already exist"

  log "Creating CNAME for api.$DOMAIN → $API_FQDN..."
  az network dns record-set cname set-record \
    --resource-group "$DNS_RG" \
    --zone-name "$DOMAIN" \
    --record-set-name "api" \
    --cname "$API_FQDN" \
    -o none 2>/dev/null || warn "CNAME may already exist"

  log "Creating TXT verification for $DOMAIN..."
  az network dns record-set txt add-record \
    --resource-group "$DNS_RG" \
    --zone-name "$DOMAIN" \
    --record-set-name "asuid" \
    --value "$ENVIRONMENT_VERIFICATION" \
    -o none 2>/dev/null || warn "TXT record may already exist"

  log "Creating TXT verification for api.$DOMAIN..."
  az network dns record-set txt add-record \
    --resource-group "$DNS_RG" \
    --zone-name "$DOMAIN" \
    --record-set-name "asuid.api" \
    --value "$ENVIRONMENT_VERIFICATION" \
    -o none 2>/dev/null || warn "TXT record may already exist"

  # ── Bind Custom Domains ──────────────────────────────────────────────────
  log "Waiting 30s for DNS propagation..."
  sleep 30

  log "Binding $DOMAIN to web container app..."
  az containerapp hostname bind \
    --name signalsentry-prod-web \
    --resource-group "$APPS_RG" \
    --hostname "$DOMAIN" \
    --environment signalsentry-prod \
    --validation-method CNAME \
    -o none || warn "Domain binding may need manual retry after DNS propagation"

  log "Binding api.$DOMAIN to API container app..."
  az containerapp hostname bind \
    --name signalsentry-prod-api \
    --resource-group "$APPS_RG" \
    --hostname "api.$DOMAIN" \
    --environment signalsentry-prod \
    --validation-method CNAME \
    -o none || warn "Domain binding may need manual retry after DNS propagation"

  echo
  log "DNS setup complete!"
  log "Managed TLS certificates will be provisioned automatically (may take a few minutes)."
  echo
  echo "Verify with:"
  echo "  curl -I https://$DOMAIN"
  echo "  curl -I https://api.$DOMAIN/health"
}

# ── Entry Point ──────────────────────────────────────────────────────────────

case "${1:-setup}" in
  setup)     setup_infra ;;
  setup-dns) setup_dns ;;
  *)         echo "Usage: $0 [setup|setup-dns]"; exit 1 ;;
esac
