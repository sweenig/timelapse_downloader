FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Only copy requirements and install deps; do NOT copy the repo contents.
# The project directory should be bind-mounted at runtime to /app.
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Declare /app as a volume so files written by the container persist on host
# when the host directory is mounted.
VOLUME ["/app"]

ENTRYPOINT ["python", "get_timelapse.py"]
