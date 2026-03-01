FROM nginx:alpine

COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY login.html /etc/nginx/login.html

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
