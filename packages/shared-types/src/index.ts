export interface ServiceHealth {
  status: 'ok' | 'error';
  service: string;
  timestamp: string;
}

export interface CorrelatedRequest {
  correlationId: string;
}
