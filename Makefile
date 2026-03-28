# SVUMS Development Makefile
# Run `make help` to see available targets.

SHELL := /bin/bash
BACKEND_DIR := backend
FRONTEND_DIR := frontend
VENV := venv
PYTHON := $(VENV)/bin/python

# Dev environment variables for local backend
export ALLOW_INSECURE_DEFAULTS=true
export ADMIN_PASSWORD=dev
export COOKIE_SECRET=dev-secret-key-at-least-32-chars
export COOKIE_SECURE=false
export CORS_ORIGINS=http://localhost:5173
export PUBLIC_BASE_URL=http://localhost:5173

.PHONY: help setup test backend frontend build lint clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

setup: ## Install all dependencies (backend + frontend)
	@bash scripts/dev-setup.sh

test: ## Run backend tests
	cd $(BACKEND_DIR) && $(PYTHON) -m pytest -x -q $(ARGS)

test-v: ## Run backend tests (verbose)
	cd $(BACKEND_DIR) && $(PYTHON) -m pytest -v $(ARGS)

backend: ## Start backend dev server (port 8000)
	cd $(BACKEND_DIR) && $(PYTHON) -m uvicorn app.main:app --reload --port 8000

frontend: ## Start frontend dev server (port 5173)
	cd $(FRONTEND_DIR) && npm run dev

build: ## Build frontend for production
	cd $(FRONTEND_DIR) && npm run build

lint: ## Type-check frontend
	cd $(FRONTEND_DIR) && npx tsc --noEmit

clean: ## Remove venv, node_modules, and data
	rm -rf $(BACKEND_DIR)/$(VENV) $(FRONTEND_DIR)/node_modules $(BACKEND_DIR)/data
