export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: {
    correlationId?: string;
    timestamp: string;
    pagination?: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
    [key: string]: unknown;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: {
    correlationId?: string;
    timestamp: string;
    [key: string]: unknown;
  };
}
