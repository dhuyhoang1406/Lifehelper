"""Verify Notification migrations and persistence using disposable local PostgreSQL DBs.
Requires Python 3, Docker, pnpm; never migrates or drops an application database.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
SERVICE = ROOT / 'apps/notification-service'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--postgres-container', default='lifehelper-postgres-1')
    args = parser.parse_args()
    info = json.loads(subprocess.check_output(['docker', 'inspect', args.postgres_container]))[0]
    config = dict(v.split('=', 1) for v in info['Config']['Env'])
    user = config['POSTGRES_USER']
    password = config['POSTGRES_PASSWORD']
    port = info['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
    created = []

    def sql(database, statement):
        return subprocess.run(['docker', 'exec', '-i', args.postgres_container, 'psql',
            '-X', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', database, '-At'],
            input=statement, text=True, capture_output=True, check=True).stdout.strip()

    def run(database, arguments, expect_failure=False):
        env = dict(os.environ, NODE_ENV='test', DATABASE_URL=(
            f'postgresql://{quote(user, safe="")}:{quote(password, safe="")}@localhost:{port}/{database}?schema=public'))
        result = subprocess.run(['pnpm', '--filter', '@lifehelper/notification-service', *arguments],
            cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        # Do not print database credentials, including accidental tool error echoes.
        output = result.stdout.replace(env['DATABASE_URL'], '[test database]').replace(password, '[redacted]')
        if expect_failure:
            if result.returncode == 0:
                raise RuntimeError('Expected migration failure on duplicate legacy events: ' + output)
        else:
            print(output, flush=True)
            if result.returncode:
                raise RuntimeError('Notification verification command failed')

    def create():
        database = 'notification_' + uuid.uuid4().hex + '_test'
        sql('postgres', f'CREATE DATABASE "{database}"')
        created.append(database)  # Only successfully created, owned DBs may be dropped.
        return database

    legacy_insert = """INSERT INTO notifications(id,user_id,type,title,body,data,status,created_at)
      VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',
      'REMINDER','Legacy','History','{"legacy":true}','SENT','2026-01-01T00:00:00Z');"""
    try:
        clean = create()
        run(clean, ['db:migrate'])
        run(clean, ['exec', 'prisma', 'migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'])
        run(clean, ['test:persistence'])
        with tempfile.TemporaryDirectory(prefix='notification-migration-') as temp:
            schema = Path(temp) / 'schema.prisma'
            shutil.copy2(SERVICE / 'prisma/schema.prisma', schema)
            migrations = Path(temp) / 'migrations'
            migrations.mkdir()
            shutil.copy2(SERVICE / 'prisma/migrations/migration_lock.toml', migrations)
            shutil.copytree(SERVICE / 'prisma/migrations/20260828000100_initial_persistence', migrations / '20260828000100_initial_persistence')
            upgrade = create()
            run(upgrade, ['exec', 'prisma', 'migrate', 'deploy', '--schema', str(schema)])
            sql(upgrade, legacy_insert)
            sql(upgrade, """INSERT INTO notification_deliveries(id,notification_id,device_session_id,provider,status,attempt_count,last_error,created_at,updated_at)
                VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001',
                '00000000-0000-4000-8000-000000000011','FCM','FAILED',2,'historical error',
                '2026-01-01T07:00:00+07:00','2026-01-01T00:01:00Z')""")
            run(upgrade, ['db:migrate'])
            assert sql(upgrade, "SELECT count(*) FROM notifications WHERE status='SENT' AND data->>'legacy'='true' AND source_reminder_id IS NULL AND eligible_at=created_at AND read_at IS NULL") == '1'
            assert sql(upgrade, 'SELECT count(*) FROM notification_dispatch_work') == '0'
            assert sql(upgrade, "SELECT count(*) FROM notification_deliveries WHERE status='FAILED' AND attempt_count=2 AND last_error='historical error' AND failed_at IS NULL AND next_attempt_at=created_at AND created_at='2026-01-01T00:00:00Z'") == '1' 
            print('PASS: legacy notification content/status preserved; no historical pushes queued', flush=True)
            duplicate = create()
            run(duplicate, ['exec', 'prisma', 'migrate', 'deploy', '--schema', str(schema)])
            sql(duplicate, legacy_insert)
            sql(duplicate, "UPDATE notifications SET source_event_id='00000000-0000-4000-8000-000000000003'")
            sql(duplicate, "INSERT INTO notifications SELECT '00000000-0000-4000-8000-000000000004',user_id,type,title,body,data,source_event_id,status,created_at,sent_at,failed_at FROM notifications")
            run(duplicate, ['db:migrate'], expect_failure=True)
            assert sql(duplicate, "SELECT count(*) FROM information_schema.columns WHERE table_name='notifications' AND column_name='eligible_at'") == '0'
            assert sql(duplicate, 'SELECT count(*) FROM notifications') == '2'
            print('PASS: duplicate legacy event aborts migration atomically without deleting history', flush=True)
    finally:
        errors = []
        for database in reversed(created):
            try:
                sql('postgres', f'DROP DATABASE "{database}" WITH (FORCE)')
                print(f'Cleaned owned test database: {database}', flush=True)
            except Exception as error:
                errors.append(database)
                print(f'Cleanup failed for owned test database {database}: {type(error).__name__}', flush=True)
        if errors:
            raise RuntimeError('Manual cleanup required for owned test databases: ' + ', '.join(errors))


if __name__ == '__main__':
    main()
