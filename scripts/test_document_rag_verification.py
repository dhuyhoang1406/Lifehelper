"""Failure-path tests for owned verification resource cleanup; no Docker calls."""
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('verification', Path(__file__).with_name('verify-document-rag.py'))
verification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verification)


class VerificationTests(unittest.TestCase):
    def resources(self):
        value = verification.Resources.__new__(verification.Resources)
        value.tag = '0123456789ab'
        value.databases, value.buckets, value.servers = [], [], []
        value.sql, value.aws = Mock(return_value=''), Mock(return_value={})
        value.pg_env = {'POSTGRES_USER': 'test', 'POSTGRES_PASSWORD': 'test'}
        return value

    def test_failed_database_creation_does_not_register_or_drop_existing_database(self):
        resources = self.resources()
        resources.sql.side_effect = RuntimeError('CREATE failed')
        with self.assertRaises(RuntimeError):
            resources.database('document')
        self.assertEqual(resources.databases, [])
        resources.sql.reset_mock()
        resources.close()
        resources.sql.assert_not_called()

    def test_cleanup_attempts_every_owned_resource_despite_failure(self):
        resources = self.resources()
        resources.databases = ['created_one_test', 'created_two_test']
        resources.buckets = ['created-bucket']
        resources.servers = [Mock()]
        resources.aws.side_effect = RuntimeError('S3 unavailable')
        with self.assertRaises(ExceptionGroup):
            resources.close()
        resources.servers[0].close.assert_called_once()
        self.assertEqual(resources.sql.call_count, 2)
        self.assertEqual(resources.sql.call_args_list[0].args[0], 'DROP DATABASE "created_two_test" WITH (FORCE)')

    def test_delete_objects_partial_failure_is_not_reported_as_success(self):
        resources = self.resources()
        resources.buckets = ['created-bucket']
        resources.aws.side_effect = [
            {'Versions': [{'Key': 'source', 'VersionId': 'version'}]},
            {'Errors': [{'Code': 'AccessDenied'}]},
        ]
        with self.assertRaises(ExceptionGroup):
            resources.close()
        self.assertEqual(resources.aws.call_count, 2)

    def test_no_owned_resources_means_no_database_or_bucket_mutations(self):
        resources = self.resources()
        resources.close()
        resources.sql.assert_not_called()
        resources.aws.assert_not_called()

    def test_small_sample_percentiles_and_empty_metrics_are_explicit(self):
        self.assertEqual(verification.distribution([]), {'n': 0, 'p50Ms': None, 'p95Ms': None})
        self.assertEqual(verification.distribution([50, 10, 20]), {'n': 3, 'p50Ms': 20, 'p95Ms': 50})


if __name__ == '__main__':
    unittest.main()
