FROM mysql:8.4
COPY infrastructure/mysql/init/01-create-schemas.sh /docker-entrypoint-initdb.d/01-create-schemas.sh
RUN chmod 0755 /docker-entrypoint-initdb.d/01-create-schemas.sh

