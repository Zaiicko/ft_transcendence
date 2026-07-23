NAME = Saveboxd
COMPOSE = docker compose
URL = https://localhost:8443

RED = \033[31m
YELLOW = \033[93m
GREEN = \033[32m
CYAN = \033[36m
RESET = \033[0m
BOLD = \033[1m

SPINNERS = "🔄 🔁 🔃 🔄 🔁 🔃"

# ─────────────────────────────── Deploy ───────────────────────────────

all: logo up

# Single-command deployment (subject requirement). The backend's entrypoint
# also auto-imports the committed catalog fixture on a fresh DB (catalog:ensure),
# so `make` alone yields a populated, demoable app — no manual seed needed.
up: .env
	@echo "$(BOLD)$(YELLOW)Building & starting containers... 🐳$(RESET)"
	@$(COMPOSE) up --build -d
	@i=0; \
	while ! curl -sk $(URL)/api/health 2>/dev/null | grep -q '"ok"'; do \
		i=$$((i + 1)); \
		if [ $$i -gt 90 ]; then \
			printf "\n$(BOLD)$(RED)Timeout — check 'make logs' ❌$(RESET)\n"; \
			exit 1; \
		fi; \
		spinner=$$(echo $(SPINNERS) | cut -d ' ' -f $$(($$i % 6 + 1))); \
		printf "\r$(BOLD)$(YELLOW)Waiting for the stack to be ready $${spinner}$(RESET)"; \
		sleep 1; \
	done; \
	printf "\r$(BOLD)$(GREEN)%-50s$(RESET)\n" "$(NAME) is up! 🚀"
	@echo "$(BOLD)$(CYAN)   ➜ App    : $(URL)$(RESET)"
	@echo "$(BOLD)$(CYAN)   ➜ Health : $(URL)/api/health$(RESET)"

.env:
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "$(BOLD)$(YELLOW).env created from .env.example — fill in your secrets! 🔑$(RESET)"; \
	fi

# ────────────────────────── Catalog & data ────────────────────────────

# Refresh/enlarge the catalog from IGDB (needs IGDB creds in .env). NOT required
# at first run — `make` auto-imports the committed fixture (catalog_seed.json).
# Use this to grow beyond it, e.g. make seed SEED_COUNT=9000
seed:
	@echo "$(BOLD)$(YELLOW)Seeding the game catalog from IGDB... 🎮$(RESET)"
	@$(COMPOSE) exec -e SEED_COUNT=$${SEED_COUNT:-1000} backend npm run seed
	@echo "$(BOLD)$(GREEN)Catalog seeded! ✅$(RESET)"

# Map games to Steam AppIDs and fetch their % of positive reviews
# Usage: make steam [STEAM_COUNT=100]
steam:
	@echo "$(BOLD)$(YELLOW)Syncing Steam scores... ♨️$(RESET)"
	@$(COMPOSE) exec -e STEAM_COUNT=$${STEAM_COUNT:-} backend npm run steam:sync
	@echo "$(BOLD)$(GREEN)Steam scores synced! ✅$(RESET)"

# Share a FULLER catalog than the committed fixture (Game/Genre/Platform/Company
# only). Upserts by igdbId — never touches Users/Reviews/etc, so it can't wipe
# anyone's local test data. One member runs catalog-export, sends the file,
# others run catalog-import.
CATALOG_FILE = backend/catalog_export.json

catalog-export:
	@$(COMPOSE) exec backend npm run catalog:export
	@echo "$(BOLD)$(GREEN)Catalog exported to $(CATALOG_FILE) ($$(du -h $(CATALOG_FILE) | cut -f1)) 📦$(RESET)"

catalog-import:
	@test -f $(CATALOG_FILE) || (echo "$(BOLD)$(RED)$(CATALOG_FILE) not found — put it there first.$(RESET)" && exit 1)
	@$(COMPOSE) exec backend npm run catalog:import
	@echo "$(BOLD)$(GREEN)Catalog imported — your users/reviews were untouched ✅$(RESET)"

# Share the WHOLE database (all tables, including users/reviews) as a SQL dump.
# ⚠️ db-restore REPLACES your entire local database.
DUMP_FILE = saveboxd_dump.sql

db-dump:
	@$(COMPOSE) exec -T postgres sh -c 'pg_dump -U $$POSTGRES_USER -d $$POSTGRES_DB --clean --if-exists' > $(DUMP_FILE)
	@echo "$(BOLD)$(GREEN)Database exported to $(DUMP_FILE) ($$(du -h $(DUMP_FILE) | cut -f1)) 📦$(RESET)"

db-restore:
	@test -f $(DUMP_FILE) || (echo "$(BOLD)$(RED)$(DUMP_FILE) not found — put it at the repo root first.$(RESET)" && exit 1)
	@$(COMPOSE) exec -T postgres sh -c 'psql -q -U $$POSTGRES_USER -d $$POSTGRES_DB' < $(DUMP_FILE)
	@$(COMPOSE) restart backend > /dev/null
	@echo "$(BOLD)$(GREEN)Database restored from $(DUMP_FILE) ✅$(RESET)"

# ───────────────────────────── Lifecycle ──────────────────────────────

logs:
	@$(COMPOSE) logs -f

ps:
	@$(COMPOSE) ps

# Stop containers (DB volume is kept)
down clean:
	@$(COMPOSE) down
	@echo "$(BOLD)$(RED)Containers stopped 🛑$(RESET)"

# Stop + remove volumes (wipes the database) and local images
fclean:
	@$(COMPOSE) down -v --rmi local
	@echo "$(BOLD)$(RED)Big clean — database wiped 🧹🗑️$(RESET)"

re: down all

logo:
	@echo "$(RED)"
	@echo "   _|_|_|                                  _|                                  _|  "
	@sleep 0.02
	@echo " _|          _|_|_|  _|      _|    _|_|    _|_|_|      _|_|    _|    _|    _|_|_|  "
	@sleep 0.02
	@echo "   _|_|    _|    _|  _|      _|  _|_|_|_|  _|    _|  _|    _|    _|_|    _|    _|  "
	@sleep 0.02
	@echo "       _|  _|    _|    _|  _|    _|        _|    _|  _|    _|  _|    _|  _|    _|  "
	@sleep 0.02
	@echo " _|_|_|      _|_|_|      _|        _|_|_|  _|_|_|      _|_|    _|    _|    _|_|_|  "
	@sleep 0.02
	@echo "$(RESET)"
	@echo "$(BOLD)            🎮 ft_transcendence — rate your games 🎮$(RESET)"
	@echo ""

.PHONY: all up seed steam catalog-export catalog-import db-dump db-restore logs ps down clean fclean re logo
