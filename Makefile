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

all: logo up

# Single-command deployment (subject requirement)
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

# Import the most rated IGDB games into the catalog (needs IGDB creds in .env)
# Usage: make seed [SEED_COUNT=1000]
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

# Share the seeded DB with the team instead of everyone re-downloading it:
# one member runs db-dump, sends the file, others run db-restore.
DUMP_FILE = saveboxd_dump.sql

db-dump:
	@$(COMPOSE) exec -T postgres sh -c 'pg_dump -U $$POSTGRES_USER -d $$POSTGRES_DB --clean --if-exists' > $(DUMP_FILE)
	@echo "$(BOLD)$(GREEN)Database exported to $(DUMP_FILE) ($$(du -h $(DUMP_FILE) | cut -f1)) 📦$(RESET)"

# ⚠️ Replaces your WHOLE local database with the dump's content
db-restore:
	@test -f $(DUMP_FILE) || (echo "$(BOLD)$(RED)$(DUMP_FILE) not found — put it at the repo root first.$(RESET)" && exit 1)
	@$(COMPOSE) exec -T postgres sh -c 'psql -q -U $$POSTGRES_USER -d $$POSTGRES_DB' < $(DUMP_FILE)
	@$(COMPOSE) restart backend > /dev/null
	@echo "$(BOLD)$(GREEN)Database restored from $(DUMP_FILE) ✅$(RESET)"

logs:
	@$(COMPOSE) logs -f

ps:
	@$(COMPOSE) ps

down:
	@$(COMPOSE) down
	@echo "$(BOLD)$(RED)Containers stopped | 🛑$(RESET)"

# Stop containers (DB volume is kept)
clean:
	@$(COMPOSE) down
	@echo "$(BOLD)$(RED)Good clean | 🧹🗑️ $(RESET)"

# Stop + remove volumes (wipes the database) and local images
fclean:
	@$(COMPOSE) down -v --rmi local
	@echo "$(BOLD)$(RED)Big clean — database wiped | 🧹🗑️ $(RESET)"

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

.PHONY: all up seed steam db-dump db-restore logs ps down clean fclean re logo
