# Chromium + all OS deps are preinstalled in this base image.
FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

WORKDIR /app

# Install Python deps first so this layer is cached when only code changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the worker package.
COPY zeroguri_scraper ./zeroguri_scraper

# Browsers ship with the base image — no `playwright install` needed.
# If you ever switch to a slim base, uncomment the next line:
# RUN playwright install chromium

CMD ["python", "-m", "zeroguri_scraper.worker"]
