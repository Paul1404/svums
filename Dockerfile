# Stage 1: Build frontend
FROM node:26-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Build final image
FROM python:3.14-slim

WORKDIR /app

# Install system dependencies for WeasyPrint (PDF generation) and Tesseract OCR
# (text extraction from uploaded paper-form scans). tesseract-ocr-deu adds the
# German language model; eng is included by the base tesseract-ocr package.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libpangoft2-1.0-0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    libglib2.0-0 \
    shared-mime-info \
    tesseract-ocr \
    tesseract-ocr-deu \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (pytest excluded — dev only)
COPY backend/requirements.txt .
RUN pip install -r requirements.txt

# Copy backend application code (tests/venv excluded via .dockerignore)
COPY backend/ .
RUN chmod +x /app/entrypoint.sh

# Copy built frontend to static directory
COPY --from=frontend-builder /app/frontend/dist ./static

# Create data directory and non-root user
RUN mkdir -p /app/data \
    && useradd -m -u 1000 appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["/app/entrypoint.sh"]
