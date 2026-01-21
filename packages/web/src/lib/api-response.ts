/**
 * 统一 API 响应格式
 * 设计文档规范：
 * - 成功: { data: ..., message?: string }
 * - 列表: { data: [...], pagination: { page, limit, total, totalPages } }
 * - 错误: { error: { code, message, details? } }
 */

import { NextResponse } from 'next/server';
import { withCamelCasePrimary } from './key-case';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface APISuccessResponse<T> {
  data: T;
  message?: string;
}

export interface APIListResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface APIErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * 成功响应
 */
export function success<T>(data: T, message?: string): NextResponse<APISuccessResponse<T>> {
  const body: APISuccessResponse<T> = { data: withCamelCasePrimary(data) as T };
  if (message) {
    body.message = message;
  }
  return NextResponse.json(withCamelCasePrimary(body) as APISuccessResponse<T>);
}

/**
 * 列表响应（带分页）
 */
export function list<T>(
  data: T[],
  pagination: { page: number; limit: number; total: number }
): NextResponse<APIListResponse<T>> {
  const body = {
    data,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: pagination.total,
      totalPages: Math.ceil(pagination.total / pagination.limit),
    },
  };

  return NextResponse.json(withCamelCasePrimary(body) as APIListResponse<T>);
}

/**
 * 错误响应
 */
export function error(
  code: string,
  message: string,
  status: number = 400,
  details?: Record<string, unknown>
): NextResponse<APIErrorResponse> {
  const body: APIErrorResponse = {
    error: { code, message },
  };
  if (details) {
    body.error.details = details;
  }
  return NextResponse.json(withCamelCasePrimary(body) as APIErrorResponse, { status });
}

/**
 * 常用错误响应快捷方法
 */
export const errors = {
  unauthorized: (message = 'Not authenticated') =>
    error('UNAUTHORIZED', message, 401),

  forbidden: (message = 'Access denied') =>
    error('FORBIDDEN', message, 403),

  notFound: (message = 'Resource not found') =>
    error('NOT_FOUND', message, 404),

  validation: (message: string, details?: Record<string, unknown>) =>
    error('VALIDATION_ERROR', message, 400, details),

  conflict: (message: string) =>
    error('CONFLICT', message, 409),

  internal: (message = 'Internal server error') =>
    error('INTERNAL_ERROR', message, 500),
};
