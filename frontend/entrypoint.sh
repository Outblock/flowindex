#!/bin/sh

# Extract the first nameserver from /etc/resolv.conf
export DNS_RESOLVER=$(awk '/nameserver/ {print $2}' /etc/resolv.conf | head -n1)

# Fallback to Google DNS or standard Docker DNS if not found (though on Railway it should exist)
if [ -z "$DNS_RESOLVER" ]; then
    echo "Warning: No nameserver found in /etc/resolv.conf, defaulting to 8.8.8.8"
    export DNS_RESOLVER="8.8.8.8"
fi

echo "Detected DNS Resolver: $DNS_RESOLVER"

# Execute the original Nginx entrypoint
# This will handle envsubst for templates using the DNS_RESOLVER variable we just set
exec /docker-entrypoint.sh "$@"
