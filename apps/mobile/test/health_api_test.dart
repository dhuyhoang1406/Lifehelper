import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifehelper_mobile/health_api.dart';

void main() {
  test('parses backend health response', () async {
    final api = HealthApi(
      baseUrl: 'http://backend',
      client: MockClient((_) async =>
          http.Response('{"status":"ok","service":"identity-service"}', 200)),
    );

    final result = await api.getHealth();

    expect(result.status, 'ok');
    expect(result.service, 'identity-service');
  });
}
