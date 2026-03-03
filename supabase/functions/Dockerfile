FROM denoland/deno:2.2.10

ARG FUNCTION_NAME
WORKDIR /src
COPY ${FUNCTION_NAME}/index.ts .
RUN deno cache index.ts

EXPOSE 8000
CMD ["run", "--allow-all", "index.ts"]
