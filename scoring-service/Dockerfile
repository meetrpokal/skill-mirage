FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

COPY scoring-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY scoring-service/ .

# Artefacts are mounted as a volume in docker-compose
# but copy pipeline_utils for the service
EXPOSE 5000

CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "5000"]
