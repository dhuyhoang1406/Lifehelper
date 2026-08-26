import 'dart:convert';

import 'package:http/http.dart' as http;

class HealthStatus {
  const HealthStatus({required this.status, required this.service});

  final String status;
  final String service;

  factory HealthStatus.fromJson(Map<String, dynamic> json) => HealthStatus(
        status: json['status'] as String,
        service: json['service'] as String,
      );
}

class HealthApi {
  HealthApi({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'API_BASE_URL',
              defaultValue: 'http://10.0.2.2:3001',
            );

  final http.Client _client;
  final String _baseUrl;

  Future<HealthStatus> getHealth() async {
    final response = await _client.get(Uri.parse('$_baseUrl/health/live'));
    if (response.statusCode != 200) {
      throw Exception('Backend returned HTTP ${response.statusCode}');
    }
    return HealthStatus.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }
}
