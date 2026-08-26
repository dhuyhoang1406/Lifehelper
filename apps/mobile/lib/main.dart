import 'package:flutter/material.dart';

import 'health_api.dart';

void main() => runApp(const LifehelperApp());

class LifehelperApp extends StatelessWidget {
  const LifehelperApp({super.key, this.healthApi});

  final HealthApi? healthApi;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Lifehelper',
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      home: HealthScreen(healthApi: healthApi ?? HealthApi()),
    );
  }
}

class HealthScreen extends StatefulWidget {
  const HealthScreen({super.key, required this.healthApi});

  final HealthApi healthApi;

  @override
  State<HealthScreen> createState() => _HealthScreenState();
}

class _HealthScreenState extends State<HealthScreen> {
  late Future<HealthStatus> _health;

  @override
  void initState() {
    super.initState();
    _health = widget.healthApi.getHealth();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Lifehelper')),
      body: Center(
        child: FutureBuilder<HealthStatus>(
          future: _health,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const CircularProgressIndicator();
            }
            if (snapshot.hasError) {
              return Text('Backend unavailable: ${snapshot.error}');
            }
            return Text('Connected to ${snapshot.data!.service}');
          },
        ),
      ),
    );
  }
}
