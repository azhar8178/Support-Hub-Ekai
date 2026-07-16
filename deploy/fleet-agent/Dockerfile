FROM alpine:3.20

# curl for HTTP calls, jq for JSON parsing
RUN apk add --no-cache curl jq

COPY agent.sh /usr/local/bin/fleet-agent
RUN chmod +x /usr/local/bin/fleet-agent

# Default: run once and exit (designed to be called by a CronJob / cron daemon)
ENTRYPOINT ["/usr/local/bin/fleet-agent"]
