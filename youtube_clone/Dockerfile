FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN apt-get update \
	&& apt-get install -y --no-install-recommends build-essential curl ca-certificates ffmpeg \
	&& pip install --no-cache-dir --upgrade pip setuptools wheel \
	&& pip install --no-cache-dir -r requirements.txt \
	&& apt-get remove -y build-essential \
	&& apt-get autoremove -y \
	&& rm -rf /var/lib/apt/lists/*
COPY . .
EXPOSE 80
CMD ["gunicorn", "-b", "0.0.0.0:80", "--workers", "2", "--worker-class", "gthread", "--threads", "4", "--timeout", "180", "--graceful-timeout", "30", "--keep-alive", "5", "app:app"]
