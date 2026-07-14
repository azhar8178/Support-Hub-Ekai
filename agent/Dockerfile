FROM python:3.11-slim

RUN pip install --no-cache-dir requests psutil

COPY health-agent.py /agent/health-agent.py

# Run unbuffered so logs appear immediately in container stdout
CMD ["python", "-u", "/agent/health-agent.py"]
