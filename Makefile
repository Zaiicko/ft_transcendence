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

.PHONY: all up logs ps down clean fclean re logo
