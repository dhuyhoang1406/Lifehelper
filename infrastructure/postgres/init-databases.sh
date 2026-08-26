#!/bin/sh
set -eu

for database in identity productivity ai document notification analytics; do
  psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -c "CREATE DATABASE lifehelper_${database};"
done
